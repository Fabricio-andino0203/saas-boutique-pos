import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  ForbiddenError,
  LastOwnerError,
  NotFoundError,
  SelfActionError,
  UsernameTakenError,
  ValidationError,
} from "@/lib/errors";
import { hashSecret, verifySecret } from "@/lib/password";
import type { Role } from "@/lib/permissions";
import { findSession, login, verifyPin } from "@/modules/auth/service";
import {
  createUser,
  resetPassword,
  resetPin,
  setUserActive,
  updateUser,
} from "@/modules/users/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

async function makeUser(username: string, role: Role, isActive = true) {
  const user = await testDb.user.create({
    data: {
      name: `Usuario ${username}`,
      username,
      role,
      isActive,
      passwordHash: await hashSecret("Clave-Inicial-2026"),
    },
  });
  return { id: user.id, role };
}

const input = {
  name: "Ana Pérez",
  username: "ana",
  role: "CASHIER",
  password: "Clave-2026",
  pin: undefined,
} as const;

describe("users service", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("creates a user with hashed credentials and writes an audit row without secrets", async () => {
    const owner = await makeUser("owner", "OWNER");
    const { id } = await createUser(owner, { ...input, username: "ana", pin: "4821" }, testDb);

    const stored = await testDb.user.findUniqueOrThrow({ where: { id } });
    expect(stored.username).toBe("ana");
    expect(await verifySecret(stored.passwordHash, "Clave-2026")).toBe(true);
    expect(await verifySecret(stored.pinHash ?? "", "4821")).toBe(true);

    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "USER_CREATED" } });
    expect(log).toMatchObject({ userId: owner.id, entityType: "User", entityId: id });
    expect(log.after).toEqual({ username: "ana", name: "Ana Pérez", role: "CASHIER" });
    expect(JSON.stringify(log)).not.toMatch(/hash|Clave-2026|4821/i);
  });

  it("rejects a repeated username without leaving rows behind", async () => {
    const owner = await makeUser("owner", "OWNER");
    await createUser(owner, input, testDb);
    await expect(createUser(owner, input, testDb)).rejects.toBeInstanceOf(UsernameTakenError);
    expect(await testDb.user.count({ where: { username: "ana" } })).toBe(1);
    expect(await testDb.auditLog.count({ where: { action: "USER_CREATED" } })).toBe(1);
  });

  it("refuses actors without the user.manage capability", async () => {
    const cashier = await makeUser("cajera", "CASHIER");
    const manager = await makeUser("gerente", "MANAGER");
    await expect(createUser(cashier, input, testDb)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createUser(manager, input, testDb)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await testDb.user.count({ where: { username: "ana" } })).toBe(0);
  });

  it("rejects invalid input with a ValidationError", async () => {
    const owner = await makeUser("owner", "OWNER");
    await expect(createUser(owner, { ...input, password: "corta" }, testDb)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("audits role changes but not name-only changes", async () => {
    const owner = await makeUser("owner", "OWNER");
    const target = await makeUser("ana", "CASHIER");

    await updateUser(owner, target.id, { name: "Ana María", role: "CASHIER" }, testDb);
    expect(await testDb.auditLog.count({ where: { action: "PERMISSION_CHANGED" } })).toBe(0);

    await updateUser(owner, target.id, { name: "Ana María", role: "MANAGER" }, testDb);
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "PERMISSION_CHANGED" } });
    expect(log.before).toEqual({ role: "CASHIER" });
    expect(log.after).toEqual({ role: "MANAGER" });
    expect((await testDb.user.findUniqueOrThrow({ where: { id: target.id } })).name).toBe(
      "Ana María",
    );
  });

  it("does not let anyone change their own role or demote the last active owner", async () => {
    const owner = await makeUser("owner", "OWNER");
    await expect(
      updateUser(owner, owner.id, { name: "Yo", role: "CASHIER" }, testDb),
    ).rejects.toBeInstanceOf(SelfActionError);

    const inactiveOwner = await makeUser("viejo", "OWNER", false);
    await expect(
      updateUser(inactiveOwner, owner.id, { name: "Yo", role: "MANAGER" }, testDb),
    ).rejects.toBeInstanceOf(LastOwnerError);
    expect((await testDb.user.findUniqueOrThrow({ where: { id: owner.id } })).role).toBe("OWNER");
  });

  it("deactivates a user, closes their sessions and audits it; reactivation is audited too", async () => {
    const owner = await makeUser("owner", "OWNER");
    const target = await makeUser("ana", "CASHIER");
    const { token } = await login({ username: "ana", password: "Clave-Inicial-2026" }, testDb);

    await setUserActive(owner, target.id, false, testDb);
    expect(await findSession(token, testDb)).toBeNull();
    expect(await testDb.session.count({ where: { userId: target.id } })).toBe(0);
    await expect(
      login({ username: "ana", password: "Clave-Inicial-2026" }, testDb),
    ).rejects.toThrow();

    await setUserActive(owner, target.id, false, testDb);
    expect(await testDb.auditLog.count({ where: { action: "USER_DEACTIVATED" } })).toBe(1);

    await setUserActive(owner, target.id, true, testDb);
    expect(await testDb.auditLog.count({ where: { action: "USER_REACTIVATED" } })).toBe(1);
    await expect(
      login({ username: "ana", password: "Clave-Inicial-2026" }, testDb),
    ).resolves.toBeDefined();
  });

  it("does not let an owner deactivate themselves or the last active owner", async () => {
    const owner = await makeUser("owner", "OWNER");
    await expect(setUserActive(owner, owner.id, false, testDb)).rejects.toBeInstanceOf(
      SelfActionError,
    );

    const inactiveOwner = await makeUser("viejo", "OWNER", false);
    await expect(setUserActive(inactiveOwner, owner.id, false, testDb)).rejects.toBeInstanceOf(
      LastOwnerError,
    );
  });

  it("resets a password: new one works, old one does not, sessions close, lock clears, audit written", async () => {
    const owner = await makeUser("owner", "OWNER");
    const target = await makeUser("ana", "CASHIER");
    const { token } = await login({ username: "ana", password: "Clave-Inicial-2026" }, testDb);
    await testDb.user.update({
      where: { id: target.id },
      data: { failedLogins: 5, lockedUntil: new Date(Date.now() + 600_000) },
    });

    await resetPassword(owner, target.id, "Clave-Nueva-2026", testDb);

    const after = await testDb.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(await verifySecret(after.passwordHash, "Clave-Nueva-2026")).toBe(true);
    expect(await verifySecret(after.passwordHash, "Clave-Inicial-2026")).toBe(false);
    expect(after).toMatchObject({ failedLogins: 0, lockedUntil: null });
    // La contraseña la puso quien restablece: la persona elige una propia al entrar.
    expect(after.mustChangePassword).toBe(true);
    expect(await findSession(token, testDb)).toBeNull();
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "CREDENTIALS_RESET" } });
    expect(log.after).toEqual({ kind: "password" });
    expect(JSON.stringify(log)).not.toContain("Clave-Nueva-2026");
  });

  it("does not reset your own password from the admin screen", async () => {
    const owner = await makeUser("owner", "OWNER");
    await expect(resetPassword(owner, owner.id, "Clave-Nueva-2026", testDb)).rejects.toBeInstanceOf(
      SelfActionError,
    );
  });

  it("resets a PIN and audits it", async () => {
    const owner = await makeUser("owner", "OWNER");
    const target = await makeUser("ana", "CASHIER");
    await resetPin(owner, target.id, "9037", testDb);
    await expect(verifyPin(target.id, "9037", testDb)).resolves.toMatchObject({ id: target.id });
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "CREDENTIALS_RESET" } });
    expect(log.after).toEqual({ kind: "pin" });
    await expect(resetPin(owner, target.id, "12", testDb)).rejects.toBeInstanceOf(ValidationError);
  });

  it("reports unknown users", async () => {
    const owner = await makeUser("owner", "OWNER");
    await expect(setUserActive(owner, "no-existe", false, testDb)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      updateUser(owner, "no-existe", { name: "X", role: "CASHIER" }, testDb),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(resetPin(owner, "no-existe", "1234", testDb)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
