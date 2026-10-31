import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PLATFORM_AUTH_LIMITS } from "@/config/constants";
import {
  AccountLockedError,
  InvalidCodeError,
  InvalidCredentialsError,
  LastOwnerError,
  NotFoundError,
  SelfActionError,
  UnauthorizedError,
  UsernameTakenError,
  ValidationError,
} from "@/lib/errors";
import { totpCode, totpStep } from "@/lib/totp";
import {
  VaultError,
  createVault,
  getVault,
  parseMasterKey,
  vaultContext,
} from "@/lib/tenancy/vault";
import { rotateVaultSecrets } from "@/modules/platform/rotation";
import {
  changePlatformPassword,
  completeEnrollment,
  confirmActorPassword,
  createPlatformUser,
  findPlatformSession,
  getEnrollmentSetup,
  listPlatformUsers,
  loginWithPassword,
  resetPlatformUserTwoFactor,
  revokePlatformSession,
  setPlatformUserActive,
  unlockPlatformUser,
  verifyLoginCode,
} from "@/modules/platform/service";
import { TEST_MASTER_KEY } from "./helpers/control-url";
import {
  closeControlTestDatabase,
  controlTestDb,
  resetControlDatabase,
} from "./helpers/control-db";

const client = controlTestDb;
const PASSWORD = "una-contraseña-larga-123";
const MINUTE = 60_000;

// La hora de las pruebas parte de la real: las sesiones guardan `updatedAt` con el reloj de la base.
const base = new Date();
const at = (minutes: number) => new Date(base.getTime() + minutes * MINUTE);
const codeAt = (secret: string, date: Date) => totpCode(secret, totpStep(date));

let counter = 0;
async function makeAdmin(username = `admin${++counter}`) {
  return createPlatformUser(
    { name: `Admin ${username}`, username, password: PASSWORD },
    { actor: null },
    client,
  );
}

/** Alta completa de una persona: contraseña, aplicación de autenticación y primera sesión. Devuelve su secreto. */
async function enrolled(username: string, now = base) {
  const pending = await loginWithPassword({ username, password: PASSWORD, now }, client);
  expect(pending.next).toBe("enroll");
  const setup = await getEnrollmentSetup(pending.token, client, now);
  const full = await completeEnrollment(
    { token: pending.token, code: codeAt(setup.secret, now), now },
    client,
  );
  return { secret: setup.secret, ...full };
}

/** Sesión completa nueva de alguien que ya configuró su aplicación. */
async function signIn(username: string, secret: string, now: Date) {
  const pending = await loginWithPassword({ username, password: PASSWORD, now }, client);
  expect(pending.next).toBe("verify");
  return verifyLoginCode({ token: pending.token, code: codeAt(secret, now), now }, client);
}

async function auditActions(): Promise<string[]> {
  const rows = await client.platformAuditLog.findMany({ orderBy: [{ at: "asc" }, { id: "asc" }] });
  return rows.map((row) => row.action);
}

beforeEach(async () => {
  await resetControlDatabase();
});

afterAll(async () => {
  await closeControlTestDatabase();
});

describe("creating superadministrators", () => {
  it("stores a hash (never the password) and audits the creation", async () => {
    const user = await makeAdmin("ana");
    const row = await client.platformUser.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain(PASSWORD);
    expect(row.totpSecretEnc).toBeNull();
    expect(row.totpEnabledAt).toBeNull();

    const [entry] = await client.platformAuditLog.findMany();
    expect(entry).toMatchObject({
      action: "PLATFORM_USER_CREATED",
      targetId: user.id,
      actorId: null,
    });
    expect(JSON.stringify(entry?.details)).not.toContain(PASSWORD);
  });

  it("rejects a duplicate username and a weak password or bad username", async () => {
    await makeAdmin("ana");
    await expect(makeAdmin("ana")).rejects.toBeInstanceOf(UsernameTakenError);
    await expect(
      createPlatformUser(
        { name: "Bob", username: "bob", password: "corta" },
        { actor: null },
        client,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createPlatformUser(
        { name: "Bob", username: "Bob Dos!", password: PASSWORD },
        { actor: null },
        client,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await client.platformUser.count()).toBe(1);
  });

  it("normalizes the username to lowercase", async () => {
    const user = await createPlatformUser(
      { name: "Ana", username: "  ANA  ", password: PASSWORD },
      { actor: null },
      client,
    );
    expect(user.username).toBe("ana");
  });
});

describe("first access: password, then the authenticator app", () => {
  it("does not give access to the panel until the code is confirmed", async () => {
    await makeAdmin("ana");
    const pending = await loginWithPassword(
      { username: "ana", password: PASSWORD, now: base },
      client,
    );
    expect(pending.next).toBe("enroll");

    // La sesión pendiente se ve para continuar el alta, pero no sirve para el panel.
    expect(await findPlatformSession(pending.token, {}, client, base)).toBeNull();
    const asPending = await findPlatformSession(
      pending.token,
      { allowPending: true },
      client,
      base,
    );
    expect(asPending).toMatchObject({
      mfaVerified: false,
      user: { username: "ana", twoFactorEnabled: false },
    });
  });

  it("stores the 2FA secret encrypted and confirms it with a first code", async () => {
    await makeAdmin("ana");
    const { secret, token, user } = await enrolled("ana");

    const row = await client.platformUser.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.totpSecretEnc).toMatch(/^v1\./);
    expect(row.totpSecretEnc).not.toContain(secret);
    expect(row.totpEnabledAt).not.toBeNull();
    expect(row.totpLastStep).toBe(totpStep(base));
    expect(row.lastLoginAt).not.toBeNull();

    const session = await findPlatformSession(token, {}, client, base);
    expect(session).toMatchObject({
      mfaVerified: true,
      user: { username: "ana", twoFactorEnabled: true },
    });
    expect(await auditActions()).toEqual([
      "PLATFORM_USER_CREATED",
      "PLATFORM_2FA_ENABLED",
      "PLATFORM_LOGIN",
    ]);
  });

  it("issues a new token when the session is promoted (the old one is dead)", async () => {
    await makeAdmin("ana");
    const pending = await loginWithPassword(
      { username: "ana", password: PASSWORD, now: base },
      client,
    );
    const setup = await getEnrollmentSetup(pending.token, client, base);
    const full = await completeEnrollment(
      { token: pending.token, code: codeAt(setup.secret, base), now: base },
      client,
    );
    expect(full.token).not.toBe(pending.token);
    expect(
      await findPlatformSession(pending.token, { allowPending: true }, client, base),
    ).toBeNull();
  });

  it("a wrong code does not enable the 2FA and counts as a failed attempt", async () => {
    const user = await makeAdmin("ana");
    const pending = await loginWithPassword(
      { username: "ana", password: PASSWORD, now: base },
      client,
    );
    await expect(
      completeEnrollment({ token: pending.token, code: "000000", now: base }, client),
    ).rejects.toBeInstanceOf(InvalidCodeError);
    const row = await client.platformUser.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.totpEnabledAt).toBeNull();
    expect(row.failedLogins).toBe(1);
    expect(await auditActions()).toContain("PLATFORM_2FA_FAILED");
  });

  it("the enrollment screen is only available while 2FA is not enabled", async () => {
    await makeAdmin("ana");
    const { secret } = await enrolled("ana");
    const again = await loginWithPassword(
      { username: "ana", password: PASSWORD, now: at(1) },
      client,
    );
    expect(again.next).toBe("verify");
    await expect(getEnrollmentSetup(again.token, client, at(1))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(
      completeEnrollment({ token: again.token, code: codeAt(secret, at(1)), now: at(1) }, client),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("a stolen ciphertext moved to another user does not decrypt", async () => {
    const ana = await makeAdmin("ana");
    await makeAdmin("bob");
    await loginWithPassword({ username: "ana", password: PASSWORD, now: base }, client);
    const anaRow = await client.platformUser.findUniqueOrThrow({ where: { id: ana.id } });
    await client.platformUser.update({
      where: { username: "bob" },
      data: { totpSecretEnc: anaRow.totpSecretEnc },
    });

    const bobPending = await loginWithPassword(
      { username: "bob", password: PASSWORD, now: base },
      client,
    );
    await expect(getEnrollmentSetup(bobPending.token, client, base)).rejects.toBeInstanceOf(
      VaultError,
    );
  });
});

describe("signing in once the authenticator app is set up", () => {
  it("accepts the code of the current interval and audits the login", async () => {
    await makeAdmin("ana");
    const { secret } = await enrolled("ana");
    const full = await signIn("ana", secret, at(1));
    const session = await findPlatformSession(full.token, {}, client, at(1));
    expect(session?.user.username).toBe("ana");
    expect((await auditActions()).filter((a) => a === "PLATFORM_LOGIN")).toHaveLength(2);
  });

  it("rejects a wrong code without opening a session", async () => {
    await makeAdmin("ana");
    const { secret } = await enrolled("ana");
    const pending = await loginWithPassword(
      { username: "ana", password: PASSWORD, now: at(1) },
      client,
    );
    const wrong = codeAt(secret, at(1)) === "123456" ? "654321" : "123456";
    await expect(
      verifyLoginCode({ token: pending.token, code: wrong, now: at(1) }, client),
    ).rejects.toBeInstanceOf(InvalidCodeError);
    expect(await findPlatformSession(pending.token, {}, client, at(1))).toBeNull();
  });

  it("does not accept a code twice, even inside its validity window", async () => {
    await makeAdmin("ana");
    const { secret } = await enrolled("ana");
    const when = at(2);
    const code = codeAt(secret, when);

    const first = await loginWithPassword(
      { username: "ana", password: PASSWORD, now: when },
      client,
    );
    await verifyLoginCode({ token: first.token, code, now: when }, client);

    const second = await loginWithPassword(
      { username: "ana", password: PASSWORD, now: when },
      client,
    );
    await expect(
      verifyLoginCode({ token: second.token, code, now: when }, client),
    ).rejects.toBeInstanceOf(InvalidCodeError);

    // el código del intervalo siguiente sí vale
    const later = new Date(when.getTime() + 30_000);
    const third = await verifyLoginCode(
      { token: second.token, code: codeAt(secret, later), now: later },
      client,
    );
    expect(third.user.username).toBe("ana");
  });

  it("two simultaneous attempts with the same code: exactly one gets in", async () => {
    await makeAdmin("ana");
    const { secret } = await enrolled("ana");
    const when = at(3);
    const code = codeAt(secret, when);
    const a = await loginWithPassword({ username: "ana", password: PASSWORD, now: when }, client);
    const b = await loginWithPassword({ username: "ana", password: PASSWORD, now: when }, client);

    const results = await Promise.allSettled([
      verifyLoginCode({ token: a.token, code, now: when }, client),
      verifyLoginCode({ token: b.token, code, now: when }, client),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("an expired password step (pending session) can no longer be completed", async () => {
    await makeAdmin("ana");
    const { secret } = await enrolled("ana");
    const pending = await loginWithPassword(
      { username: "ana", password: PASSWORD, now: at(1) },
      client,
    );
    const late = at(1 + PLATFORM_AUTH_LIMITS.pendingMinutes + 1);
    await expect(
      verifyLoginCode({ token: pending.token, code: codeAt(secret, late), now: late }, client),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("an unknown token cannot verify anything", async () => {
    await expect(
      verifyLoginCode({ token: "no-existe", code: "123456", now: base }, client),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("bad credentials and lockout", () => {
  it("a wrong password and an unknown user look the same, and the unknown name is not recorded", async () => {
    await makeAdmin("ana");
    await expect(
      loginWithPassword({ username: "ana", password: "equivocada-equivocada", now: base }, client),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(
      loginWithPassword(
        { username: "secreto-que-alguien-pego-aqui", password: PASSWORD, now: base },
        client,
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    const entries = await client.platformAuditLog.findMany({
      where: { action: "PLATFORM_LOGIN_FAILED" },
    });
    expect(entries).toHaveLength(2);
    expect(JSON.stringify(entries)).not.toContain("secreto-que-alguien-pego-aqui");
  });

  it("locks the account after five failures and unlocks when the time passes", async () => {
    await makeAdmin("ana");
    const wrong = { username: "ana", password: "equivocada-equivocada" };
    for (let i = 1; i < PLATFORM_AUTH_LIMITS.maxFailedAttempts; i += 1) {
      await expect(loginWithPassword({ ...wrong, now: base }, client)).rejects.toBeInstanceOf(
        InvalidCredentialsError,
      );
    }
    await expect(loginWithPassword({ ...wrong, now: base }, client)).rejects.toBeInstanceOf(
      AccountLockedError,
    );

    // Estando bloqueada ni la contraseña correcta entra.
    await expect(
      loginWithPassword({ username: "ana", password: PASSWORD, now: at(5) }, client),
    ).rejects.toBeInstanceOf(AccountLockedError);
    expect(await auditActions()).toContain("PLATFORM_ACCOUNT_LOCKED");

    const afterLock = at(PLATFORM_AUTH_LIMITS.lockMinutes + 1);
    const ok = await loginWithPassword(
      { username: "ana", password: PASSWORD, now: afterLock },
      client,
    );
    expect(ok.next).toBe("enroll");
  });

  it("someone who knows the password cannot guess codes forever by logging in again", async () => {
    await makeAdmin("ana");
    const { secret } = await enrolled("ana");
    const now = at(10);
    const pending = await loginWithPassword({ username: "ana", password: PASSWORD, now }, client);
    const wrong = codeAt(secret, now) === "111111" ? "222222" : "111111";
    for (let i = 0; i < PLATFORM_AUTH_LIMITS.maxFailedAttempts - 1; i += 1) {
      await expect(
        verifyLoginCode({ token: pending.token, code: wrong, now }, client),
      ).rejects.toBeInstanceOf(InvalidCodeError);
    }
    // Acertar la contraseña de nuevo NO reinicia el contador de intentos.
    const again = await loginWithPassword({ username: "ana", password: PASSWORD, now }, client);
    await expect(
      verifyLoginCode({ token: again.token, code: wrong, now }, client),
    ).rejects.toBeInstanceOf(AccountLockedError);
    // ni siquiera el código correcto entra mientras dura el bloqueo
    await expect(
      verifyLoginCode({ token: again.token, code: codeAt(secret, now), now }, client),
    ).rejects.toBeInstanceOf(AccountLockedError);
  });

  it("a complete login resets the failure counter", async () => {
    const user = await makeAdmin("ana");
    const { secret } = await enrolled("ana");
    await expect(
      loginWithPassword({ username: "ana", password: "equivocada-equivocada", now: at(1) }, client),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(
      (await client.platformUser.findUniqueOrThrow({ where: { id: user.id } })).failedLogins,
    ).toBe(1);
    await signIn("ana", secret, at(2));
    expect(
      (await client.platformUser.findUniqueOrThrow({ where: { id: user.id } })).failedLogins,
    ).toBe(0);
  });

  it("a deactivated user cannot start a login", async () => {
    const ana = await makeAdmin("ana");
    const boss = await makeAdmin("jefe");
    await setPlatformUserActive({ userId: ana.id, active: false }, { actor: boss }, client);
    await expect(
      loginWithPassword({ username: "ana", password: PASSWORD, now: base }, client),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});

describe("sessions", () => {
  it("expire at the end of their length, however active they are", async () => {
    await makeAdmin("ana");
    const { token, expires } = await enrolled("ana");
    expect(expires.getTime() - base.getTime()).toBe(
      PLATFORM_AUTH_LIMITS.sessionHours * 60 * MINUTE,
    );
    // Una sesión activa hasta el último momento: vence por su fecha, no por inactividad.
    await client.platformSession.updateMany({ data: { expires: at(10) } });
    expect(await findPlatformSession(token, {}, client, at(9))).not.toBeNull();
    expect(await findPlatformSession(token, {}, client, at(11))).toBeNull();
    expect(await client.platformSession.count()).toBe(0);
  });

  it("close after the idle time, but activity keeps them alive", async () => {
    await makeAdmin("ana");
    const { token } = await enrolled("ana");
    const idle = PLATFORM_AUTH_LIMITS.idleMinutes;
    // Cada consulta cuenta como actividad: mientras haya menos de `idle` minutos entre una y otra, sigue viva.
    expect(await findPlatformSession(token, {}, client, at(idle - 5))).not.toBeNull();
    expect(await findPlatformSession(token, {}, client, at(2 * idle - 10))).not.toBeNull();
    // Sin actividad durante más del límite, se cierra y se borra.
    expect(await findPlatformSession(token, {}, client, at(3 * idle + 5))).toBeNull();
    expect(await client.platformSession.count()).toBe(0);
  });

  it("are revoked on logout, and logout is audited", async () => {
    await makeAdmin("ana");
    const { token } = await enrolled("ana");
    await revokePlatformSession(token, { ip: "10.0.0.1" }, client);
    expect(await findPlatformSession(token, {}, client, base)).toBeNull();
    const logout = await client.platformAuditLog.findFirstOrThrow({
      where: { action: "PLATFORM_LOGOUT" },
    });
    expect(logout.ip).toBe("10.0.0.1");
  });

  it("a pending session that is revoked is not audited as a logout", async () => {
    await makeAdmin("ana");
    const pending = await loginWithPassword(
      { username: "ana", password: PASSWORD, now: base },
      client,
    );
    await revokePlatformSession(pending.token, {}, client);
    expect(await auditActions()).not.toContain("PLATFORM_LOGOUT");
  });

  it("store only a hash of the token", async () => {
    await makeAdmin("ana");
    const { token } = await enrolled("ana");
    const rows = await client.platformSession.findMany();
    expect(rows.map((r) => r.sessionToken)).not.toContain(token);
    expect(rows[0]?.sessionToken).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("administering other superadministrators", () => {
  it("deactivating closes their sessions, is audited, and can be undone", async () => {
    const boss = await makeAdmin("jefe");
    const ana = await makeAdmin("ana");
    const { token } = await enrolled("ana");

    await setPlatformUserActive(
      { userId: ana.id, active: false },
      { actor: boss, ip: "1.2.3.4" },
      client,
    );
    expect(await findPlatformSession(token, {}, client, base)).toBeNull();
    expect(await client.platformSession.count({ where: { userId: ana.id } })).toBe(0);

    await setPlatformUserActive({ userId: ana.id, active: true }, { actor: boss }, client);
    expect((await listPlatformUsers(client)).find((u) => u.id === ana.id)?.isActive).toBe(true);

    const actions = await auditActions();
    expect(actions).toContain("PLATFORM_USER_DEACTIVATED");
    expect(actions).toContain("PLATFORM_USER_REACTIVATED");
    const entry = await client.platformAuditLog.findFirstOrThrow({
      where: { action: "PLATFORM_USER_DEACTIVATED" },
    });
    expect(entry).toMatchObject({ actorUsername: "jefe", targetId: ana.id, ip: "1.2.3.4" });
  });

  it("nobody can deactivate themselves, and the last active administrator always remains", async () => {
    const boss = await makeAdmin("jefe");
    const ana = await makeAdmin("ana");
    await expect(
      setPlatformUserActive({ userId: boss.id, active: false }, { actor: boss }, client),
    ).rejects.toBeInstanceOf(SelfActionError);

    await setPlatformUserActive({ userId: ana.id, active: false }, { actor: boss }, client);
    // El único que queda activo no se puede desactivar ni por un actor externo (la CLI).
    await expect(
      setPlatformUserActive({ userId: boss.id, active: false }, { actor: null }, client),
    ).rejects.toBeInstanceOf(LastOwnerError);
  });

  it("two simultaneous deactivations cannot leave the platform without administrators", async () => {
    const a = await makeAdmin("a-user");
    const b = await makeAdmin("b-user");
    const results = await Promise.allSettled([
      setPlatformUserActive({ userId: a.id, active: false }, { actor: b }, client),
      setPlatformUserActive({ userId: b.id, active: false }, { actor: a }, client),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeLessThanOrEqual(1);
    expect(await client.platformUser.count({ where: { isActive: true } })).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("an unknown target is reported, not ignored", async () => {
    await expect(
      setPlatformUserActive({ userId: "nope", active: false }, { actor: null }, client),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      resetPlatformUserTwoFactor("nope", { actor: null }, client),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("resetting the 2FA removes the app, closes the sessions and makes them enroll again", async () => {
    const boss = await makeAdmin("jefe");
    const ana = await makeAdmin("ana");
    const { token, secret } = await enrolled("ana");

    await resetPlatformUserTwoFactor(ana.id, { actor: boss }, client);
    expect(await findPlatformSession(token, {}, client, base)).toBeNull();
    const row = await client.platformUser.findUniqueOrThrow({ where: { id: ana.id } });
    expect(row).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null });

    const next = await loginWithPassword(
      { username: "ana", password: PASSWORD, now: at(1) },
      client,
    );
    expect(next.next).toBe("enroll");
    const setup = await getEnrollmentSetup(next.token, client, at(1));
    expect(setup.secret).not.toBe(secret); // un secreto nuevo
    expect(await auditActions()).toContain("PLATFORM_2FA_RESET");
  });

  it("unlocking clears the failure counter", async () => {
    const boss = await makeAdmin("jefe");
    const ana = await makeAdmin("ana");
    for (let i = 0; i < PLATFORM_AUTH_LIMITS.maxFailedAttempts; i += 1) {
      await loginWithPassword(
        { username: "ana", password: "equivocada-equivocada", now: base },
        client,
      ).catch(() => undefined);
    }
    expect(
      (await listPlatformUsers(client)).find((u) => u.id === ana.id)?.lockedUntil,
    ).not.toBeNull();
    await unlockPlatformUser(ana.id, { actor: boss }, client);
    const ok = await loginWithPassword({ username: "ana", password: PASSWORD, now: base }, client);
    expect(ok.next).toBe("enroll");
    expect(await auditActions()).toContain("PLATFORM_USER_UNLOCKED");
  });

  it("confirming the actor's password counts failures like a login", async () => {
    const boss = await makeAdmin("jefe");
    await expect(confirmActorPassword(boss.id, PASSWORD, {}, client)).resolves.toBeUndefined();
    for (let i = 0; i < PLATFORM_AUTH_LIMITS.maxFailedAttempts - 1; i += 1) {
      await expect(
        confirmActorPassword(boss.id, "equivocada-equivocada", {}, client),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    await expect(
      confirmActorPassword(boss.id, "equivocada-equivocada", {}, client),
    ).rejects.toBeInstanceOf(AccountLockedError);
  });
});

describe("changing the password", () => {
  it("needs the current password, enforces the length, keeps this session and closes the rest", async () => {
    await makeAdmin("ana");
    const first = await enrolled("ana");
    const second = await signIn("ana", first.secret, at(1));
    const session = await findPlatformSession(first.token, {}, client, at(1));

    await expect(
      changePlatformPassword(
        {
          userId: first.user.id,
          currentPassword: "equivocada-equivocada",
          newPassword: "otra-contraseña-larga-9",
        },
        {},
        client,
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(
      changePlatformPassword(
        { userId: first.user.id, currentPassword: PASSWORD, newPassword: "corta" },
        {},
        client,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    await changePlatformPassword(
      {
        userId: first.user.id,
        currentPassword: PASSWORD,
        newPassword: "otra-contraseña-larga-9",
        keepSessionId: session?.sessionId,
      },
      {},
      client,
    );
    expect(await findPlatformSession(first.token, {}, client, at(1))).not.toBeNull();
    expect(await findPlatformSession(second.token, {}, client, at(1))).toBeNull();

    await expect(
      loginWithPassword({ username: "ana", password: PASSWORD, now: at(2) }, client),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    const ok = await loginWithPassword(
      { username: "ana", password: "otra-contraseña-larga-9", now: at(2) },
      client,
    );
    expect(ok.next).toBe("verify");
    expect(await auditActions()).toContain("PLATFORM_PASSWORD_CHANGED");
  });
});

describe("the audit log", () => {
  it("is append-only: it cannot be edited or deleted", async () => {
    await makeAdmin("ana");
    const entry = await client.platformAuditLog.findFirstOrThrow();
    // El adaptador de Prisma a veces oculta el mensaje del trigger; se acepta el texto o el código SQL 23001.
    const refused = (error: unknown) =>
      /solo inserción|23001/.test(
        JSON.stringify(error) + (error instanceof Error ? error.message : ""),
      );
    await expect(
      client.$executeRaw`UPDATE "PlatformAuditLog" SET "action" = 'OTRA'`,
    ).rejects.toSatisfy(refused);
    await expect(client.$executeRaw`DELETE FROM "PlatformAuditLog"`).rejects.toSatisfy(refused);
    await expect(
      client.platformAuditLog.update({ where: { id: entry.id }, data: { action: "OTRA" } }),
    ).rejects.toThrow();
    await expect(client.platformAuditLog.deleteMany({})).rejects.toThrow();
    const rows = await client.platformAuditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("PLATFORM_USER_CREATED");
  });

  it("never contains passwords, codes or secrets across a whole session lifecycle", async () => {
    await makeAdmin("ana");
    const { secret } = await enrolled("ana");
    await signIn("ana", secret, at(1));
    await loginWithPassword({
      username: "ana",
      password: "equivocada-equivocada",
      now: at(2),
    }).catch(() => undefined);
    const dump = JSON.stringify(await client.platformAuditLog.findMany());
    for (const forbidden of [PASSWORD, "equivocada-equivocada", secret, codeAt(secret, at(1))]) {
      expect(dump).not.toContain(forbidden);
    }
  });
});

describe("database constraints of the central database", () => {
  it("only accepts well-formed subdomains", async () => {
    for (const slug of [
      "Mayusculas",
      "con espacio",
      "-empieza",
      "termina-",
      "a_b",
      "",
      "x".repeat(41),
    ]) {
      await expect(client.tenant.create({ data: { slug, name: "N" } }), slug).rejects.toThrow();
    }
    const tenant = await client.tenant.create({ data: { slug: "tienda-a1", name: "Tienda A" } });
    expect(tenant.status).toBe("PROVISIONING");
    expect(tenant.dbServerId).toBe("primary");
  });

  it("an operating business must have its database, role and stored credential", async () => {
    await expect(
      client.tenant.create({ data: { slug: "sin-base", name: "N", status: "ACTIVE" } }),
    ).rejects.toThrow();
    const id = "tenant-ok";
    const created = await client.tenant.create({
      data: {
        id,
        slug: "con-base",
        name: "N",
        status: "ACTIVE",
        dbName: "t_ok",
        dbRole: "t_ok",
        dbCredentialEnc: getVault().encrypt("pw", vaultContext.tenantDatabase(id)),
      },
    });
    expect(created.status).toBe("ACTIVE");
  });

  it("a confirmed 2FA needs a stored secret", async () => {
    const ana = await makeAdmin("ana");
    await expect(
      client.platformUser.update({ where: { id: ana.id }, data: { totpEnabledAt: new Date() } }),
    ).rejects.toThrow();
  });
});

describe("master key rotation", () => {
  it("re-encrypts every secret with the new key, once, and the old key is no longer needed", async () => {
    await makeAdmin("ana");
    await enrolled("ana");
    const tenantId = "tenant-rot";
    await client.tenant.create({
      data: {
        id: tenantId,
        slug: "rotando",
        name: "Rotando",
        dbCredentialEnc: getVault().encrypt("db-password", vaultContext.tenantDatabase(tenantId)),
      },
    });

    const newKey = { version: 2, key: Buffer.alloc(32, 11) };
    const vault2 = createVault(newKey, [{ version: 1, key: parseMasterKey(TEST_MASTER_KEY) }]);

    const first = await rotateVaultSecrets({ id: "x", username: "operador" }, client, vault2);
    expect(first).toEqual({ rotated: 2, alreadyCurrent: 0, toVersion: 2 });
    const second = await rotateVaultSecrets(null, client, vault2);
    expect(second).toEqual({ rotated: 0, alreadyCurrent: 2, toVersion: 2 });

    const tenant = await client.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.dbCredentialEnc).toMatch(/^v2\./);
    expect(
      createVault(newKey).decrypt(
        tenant.dbCredentialEnc as string,
        vaultContext.tenantDatabase(tenantId),
      ),
    ).toBe("db-password");
    const entry = await client.platformAuditLog.findFirstOrThrow({
      where: { action: "PLATFORM_KEY_ROTATED" },
      orderBy: { at: "asc" },
    });
    expect(entry.details).toMatchObject({ toVersion: 2, rotated: 2 });
  });
});
