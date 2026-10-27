import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { AccountLockedError, ForbiddenError, InvalidCredentialsError } from "@/lib/errors";
import { hashSecret } from "@/lib/password";
import type { Role } from "@/lib/permissions";
import { findSession, switchUserWithPin } from "@/modules/auth/service";
import { generateSessionToken, hashSessionToken } from "@/modules/auth/token";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const PINS = { cashier: "3333", manager: "2222", warehouse: "4444" } as const;
let hashes: Promise<Record<keyof typeof PINS, string>> | undefined;
function getHashes() {
  hashes ??= (async () => ({
    cashier: await hashSecret(PINS.cashier),
    manager: await hashSecret(PINS.manager),
    warehouse: await hashSecret(PINS.warehouse),
  }))();
  return hashes;
}

async function world() {
  const pinHashes = await getHashes();
  const make = (
    username: string,
    role: Role,
    extra: { pinHash?: string; isActive?: boolean } = {},
  ) =>
    testDb.user.create({
      data: { name: `Nombre ${username}`, username, passwordHash: "x", role, ...extra },
    });
  const cashier = await make("cashier", "CASHIER", { pinHash: pinHashes.cashier });
  const manager = await make("manager", "MANAGER", { pinHash: pinHashes.manager });
  const warehouse = await make("warehouse", "WAREHOUSE", { pinHash: pinHashes.warehouse });
  const retired = await make("retired", "CASHIER", { pinHash: pinHashes.cashier, isActive: false });
  const nopin = await make("nopin", "CASHIER");

  // La sesión que está usando quien está en el mostrador
  const token = generateSessionToken();
  const current = await testDb.session.create({
    data: {
      sessionToken: hashSessionToken(token),
      userId: cashier.id,
      expires: new Date(Date.now() + 3_600_000),
    },
  });
  return { cashier, manager, warehouse, retired, nopin, token, current };
}

describe("switchUserWithPin", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("gives the other person their own session and closes the one that was in use", async () => {
    const w = await world();
    const result = await switchUserWithPin(
      { username: "manager", pin: PINS.manager, currentSessionId: w.current.id },
      testDb,
    );
    expect(result.user).toMatchObject({ id: w.manager.id, role: "MANAGER", username: "manager" });
    expect(result.expires.getTime()).toBeGreaterThan(Date.now());

    // La sesión nueva sirve y es de quien entró; la anterior ya no existe
    expect((await findSession(result.token, testDb))?.user.id).toBe(w.manager.id);
    expect(await findSession(w.token, testDb)).toBeNull();
    expect(await testDb.session.count({ where: { id: w.current.id } })).toBe(0);
    expect(
      (await testDb.user.findUniqueOrThrow({ where: { id: w.manager.id } })).lastLoginAt,
    ).toBeInstanceOf(Date);
  });

  it("is not picky about spaces and capital letters in the username", async () => {
    const w = await world();
    const result = await switchUserWithPin({ username: "  Manager ", pin: PINS.manager }, testDb);
    expect(result.user.id).toBe(w.manager.id);
  });

  it("refuses a wrong PIN, an unknown user, an inactive user and a user without a PIN", async () => {
    const w = await world();
    for (const input of [
      { username: "manager", pin: "9999" },
      { username: "nadie", pin: "1234" },
      { username: "retired", pin: PINS.cashier },
      { username: "nopin", pin: "1234" },
    ]) {
      await expect(
        switchUserWithPin({ ...input, currentSessionId: w.current.id }, testDb),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    // La sesión actual sigue en pie y nadie recibió una nueva
    expect(await testDb.session.count()).toBe(1);
    expect((await findSession(w.token, testDb))?.user.id).toBe(w.cashier.id);
  });

  it("only lets people who can sell in, even with the right PIN", async () => {
    const w = await world();
    await expect(
      switchUserWithPin({ username: "warehouse", pin: PINS.warehouse }, testDb),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await testDb.session.count()).toBe(1);
    expect(w.warehouse.id).toBeTruthy();
  });

  it("locks the account after five wrong tries, even for the right PIN", async () => {
    await world();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        switchUserWithPin({ username: "cashier", pin: "9999" }, testDb),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    await expect(
      switchUserWithPin({ username: "cashier", pin: "9999" }, testDb),
    ).rejects.toBeInstanceOf(AccountLockedError);
    await expect(
      switchUserWithPin({ username: "cashier", pin: PINS.cashier }, testDb),
    ).rejects.toBeInstanceOf(AccountLockedError);
  });

  it("clears the failed tries after a good PIN", async () => {
    const w = await world();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        switchUserWithPin({ username: "cashier", pin: "9999" }, testDb),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    await switchUserWithPin({ username: "cashier", pin: PINS.cashier }, testDb);
    expect(
      (await testDb.user.findUniqueOrThrow({ where: { id: w.cashier.id } })).failedLogins,
    ).toBe(0);
  });
});
