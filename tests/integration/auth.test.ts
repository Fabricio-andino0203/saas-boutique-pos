import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { AUTH_LIMITS } from "@/config/constants";
import { AccountLockedError, InvalidCredentialsError, ValidationError } from "@/lib/errors";
import { hashSecret, verifySecret } from "@/lib/password";
import {
  changePassword,
  findSession,
  login,
  revokeSession,
  revokeUserSessions,
  setPin,
  verifyPin,
} from "@/modules/auth/service";
import { hashSessionToken } from "@/modules/auth/token";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const PASSWORD = "Secreto-2026";
const MINUTE = 60_000;

async function createUser(overrides: { username?: string; isActive?: boolean } = {}) {
  return testDb.user.create({
    data: {
      name: "Cajera Prueba",
      username: overrides.username ?? "cajera",
      passwordHash: await hashSecret(PASSWORD),
      role: "CASHIER",
      isActive: overrides.isActive ?? true,
    },
  });
}

async function failLogins(times: number, username = "cajera", now?: Date) {
  const outcomes: unknown[] = [];
  for (let i = 0; i < times; i += 1) {
    outcomes.push(
      await login({ username, password: "mal", now }, testDb).catch((error: unknown) => error),
    );
  }
  return outcomes;
}

describe("login", () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(closeDatabase);

  it("creates a session and stores only the hash of the token", async () => {
    const user = await createUser();
    const result = await login({ username: " Cajera ", password: PASSWORD }, testDb);

    expect(result.user).toMatchObject({ id: user.id, role: "CASHIER" });
    const stored = await testDb.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.sessionToken).toBe(hashSessionToken(result.token));
    expect(stored.sessionToken).not.toBe(result.token);
    expect(
      (await testDb.user.findUniqueOrThrow({ where: { id: user.id } })).lastLoginAt,
    ).not.toBeNull();
  });

  it("rejects a wrong password and an unknown user with the same error", async () => {
    await createUser();
    await expect(login({ username: "cajera", password: "mal" }, testDb)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await expect(
      login({ username: "no-existe", password: PASSWORD }, testDb),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("rejects an inactive user even with the right password", async () => {
    await createUser({ isActive: false });
    await expect(login({ username: "cajera", password: PASSWORD }, testDb)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it("locks the account after too many failures, even for the right password", async () => {
    const user = await createUser();
    const now = new Date("2026-10-25T12:00:00.000Z");
    const outcomes = await failLogins(AUTH_LIMITS.maxFailedAttempts, "cajera", now);

    expect(outcomes.slice(0, -1).every((o) => o instanceof InvalidCredentialsError)).toBe(true);
    expect(outcomes.at(-1)).toBeInstanceOf(AccountLockedError);
    const locked = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil?.getTime()).toBe(now.getTime() + AUTH_LIMITS.lockMinutes * MINUTE);

    await expect(
      login({ username: "cajera", password: PASSWORD, now }, testDb),
    ).rejects.toBeInstanceOf(AccountLockedError);
  });

  it("lets the user back in once the lock expires and resets the counter", async () => {
    const user = await createUser();
    const now = new Date("2026-10-25T12:00:00.000Z");
    await failLogins(AUTH_LIMITS.maxFailedAttempts, "cajera", now);

    const later = new Date(now.getTime() + (AUTH_LIMITS.lockMinutes + 1) * MINUTE);
    await expect(
      login({ username: "cajera", password: PASSWORD, now: later }, testDb),
    ).resolves.toBeDefined();
    const after = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.failedLogins).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });

  it("restarts the count after an expired lock instead of locking again at once", async () => {
    await createUser();
    const now = new Date("2026-10-25T12:00:00.000Z");
    await failLogins(AUTH_LIMITS.maxFailedAttempts, "cajera", now);

    const later = new Date(now.getTime() + (AUTH_LIMITS.lockMinutes + 1) * MINUTE);
    await expect(
      login({ username: "cajera", password: "mal", now: later }, testDb),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});

describe("sessions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns the user for a valid token", async () => {
    await createUser();
    const { token, user } = await login({ username: "cajera", password: PASSWORD }, testDb);
    const session = await findSession(token, testDb);
    expect(session?.user.id).toBe(user.id);
  });

  it("returns null for an unknown token", async () => {
    expect(await findSession("token-inventado", testDb)).toBeNull();
  });

  it("expires sessions after the absolute limit and deletes them", async () => {
    await createUser();
    const start = new Date("2026-10-25T08:00:00.000Z");
    const { token } = await login({ username: "cajera", password: PASSWORD, now: start }, testDb);
    const late = new Date(start.getTime() + (AUTH_LIMITS.sessionHours * 60 + 1) * MINUTE);

    expect(await findSession(token, testDb, late)).toBeNull();
    expect(await testDb.session.count()).toBe(0);
  });

  it("expires sessions that stayed idle too long", async () => {
    await createUser();
    const { token } = await login({ username: "cajera", password: PASSWORD }, testDb);
    const stored = await testDb.session.findFirstOrThrow();
    const idle = new Date(stored.updatedAt.getTime() + (AUTH_LIMITS.idleMinutes + 1) * MINUTE);

    expect(await findSession(token, testDb, idle)).toBeNull();
  });

  it("keeps a session alive while it is used", async () => {
    await createUser();
    const { token } = await login({ username: "cajera", password: PASSWORD }, testDb);
    const stored = await testDb.session.findFirstOrThrow();
    const soon = new Date(stored.updatedAt.getTime() + (AUTH_LIMITS.idleMinutes - 5) * MINUTE);

    expect(await findSession(token, testDb, soon)).not.toBeNull();
    const touched = await testDb.session.findFirstOrThrow();
    expect(touched.updatedAt.getTime()).toBe(soon.getTime());
  });

  it("stops working once the user is deactivated", async () => {
    const user = await createUser();
    const { token } = await login({ username: "cajera", password: PASSWORD }, testDb);
    await testDb.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect(await findSession(token, testDb)).toBeNull();
  });

  it("can be revoked one by one or all at once", async () => {
    const user = await createUser();
    const first = await login({ username: "cajera", password: PASSWORD }, testDb);
    const second = await login({ username: "cajera", password: PASSWORD }, testDb);
    const third = await login({ username: "cajera", password: PASSWORD }, testDb);

    await revokeSession(first.token, testDb);
    expect(await findSession(first.token, testDb)).toBeNull();

    const keep = await findSession(second.token, testDb);
    await revokeUserSessions(user.id, keep?.sessionId, testDb);
    expect(await findSession(third.token, testDb)).toBeNull();
    expect(await findSession(second.token, testDb)).not.toBeNull();
  });
});

describe("changePassword", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("changes the password, keeps the current session and closes the others", async () => {
    const user = await createUser();
    const current = await login({ username: "cajera", password: PASSWORD }, testDb);
    const other = await login({ username: "cajera", password: PASSWORD }, testDb);
    const active = await findSession(current.token, testDb);

    await changePassword(
      {
        userId: user.id,
        currentPassword: PASSWORD,
        newPassword: "Nueva-Clave-2026",
        keepSessionId: active?.sessionId,
      },
      testDb,
    );

    const updated = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifySecret(updated.passwordHash, "Nueva-Clave-2026")).toBe(true);
    expect(await verifySecret(updated.passwordHash, PASSWORD)).toBe(false);
    expect(await findSession(current.token, testDb)).not.toBeNull();
    expect(await findSession(other.token, testDb)).toBeNull();
  });

  it("rejects a wrong current password and counts it toward the lock", async () => {
    const user = await createUser();
    await expect(
      changePassword(
        { userId: user.id, currentPassword: "mal", newPassword: "Nueva-Clave-2026" },
        testDb,
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect((await testDb.user.findUniqueOrThrow({ where: { id: user.id } })).failedLogins).toBe(1);
  });
});

describe("a temporary password", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function createTemporaryUser() {
    return testDb.user.create({
      data: {
        name: "Dueña nueva",
        username: "duena",
        passwordHash: await hashSecret(PASSWORD),
        role: "OWNER",
        mustChangePassword: true,
      },
    });
  }

  it("is reported by the login and by the session, so the system can send her to change it", async () => {
    await createTemporaryUser();
    const result = await login({ username: "duena", password: PASSWORD }, testDb);
    expect(result.mustChangePassword).toBe(true);
    const session = await findSession(result.token, testDb);
    expect(session?.mustChangePassword).toBe(true);
  });

  it("is not reported for an ordinary account", async () => {
    await createUser();
    const result = await login({ username: "cajera", password: PASSWORD }, testDb);
    expect(result.mustChangePassword).toBe(false);
    expect((await findSession(result.token, testDb))?.mustChangePassword).toBe(false);
  });

  it("stops being temporary once she chooses her own", async () => {
    const user = await createTemporaryUser();
    const first = await login({ username: "duena", password: PASSWORD }, testDb);
    const active = await findSession(first.token, testDb);

    await changePassword(
      {
        userId: user.id,
        currentPassword: PASSWORD,
        newPassword: "Mi-Propia-Clave-2026",
        keepSessionId: active?.sessionId,
      },
      testDb,
    );

    expect((await findSession(first.token, testDb))?.mustChangePassword).toBe(false);
    const next = await login({ username: "duena", password: "Mi-Propia-Clave-2026" }, testDb);
    expect(next.mustChangePassword).toBe(false);
  });

  it("cannot be 'changed' to the same password", async () => {
    const user = await createTemporaryUser();
    await expect(
      changePassword({ userId: user.id, currentPassword: PASSWORD, newPassword: PASSWORD }, testDb),
    ).rejects.toBeInstanceOf(ValidationError);
    const still = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(still.mustChangePassword).toBe(true);
  });
});

describe("quick PIN", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("stores a hashed PIN and verifies it", async () => {
    const user = await createUser();
    await setPin(user.id, "4821", testDb);

    const stored = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.pinHash).not.toBe("4821");
    await expect(verifyPin(user.id, "4821", testDb)).resolves.toMatchObject({ id: user.id });
    await expect(verifyPin(user.id, "0000", testDb)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it("rejects malformed PINs", async () => {
    const user = await createUser();
    for (const bad of ["123", "1234567", "12ab"]) {
      await expect(setPin(user.id, bad, testDb), bad).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("fails when the user has no PIN and locks after repeated failures", async () => {
    const user = await createUser();
    await expect(verifyPin(user.id, "1234", testDb)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );

    await setPin(user.id, "4821", testDb);
    const now = new Date("2026-10-25T12:00:00.000Z");
    let last: unknown;
    for (let i = 0; i < AUTH_LIMITS.maxFailedAttempts; i += 1) {
      last = await verifyPin(user.id, "0000", testDb, now).catch((error: unknown) => error);
    }
    expect(last).toBeInstanceOf(AccountLockedError);
    await expect(verifyPin(user.id, "4821", testDb, now)).rejects.toBeInstanceOf(
      AccountLockedError,
    );
  });
});
