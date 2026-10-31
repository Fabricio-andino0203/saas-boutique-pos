import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ConflictError, UsernameTakenError, ValidationError } from "@/lib/errors";
import { verifySecret } from "@/lib/password";
import { login, verifyPin } from "@/modules/auth/service";
import { createFirstOwner } from "@/modules/users/bootstrap";
import { seedBase } from "../../prisma/seed/run-seed";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const input = {
  name: "Rosa Martínez",
  username: "rosa",
  password: "Contraseña-Propia-1",
  pin: "482916",
};

describe("first run of a fresh installation", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("seeds the base data without any demo user", async () => {
    await seedBase(testDb);
    await seedBase(testDb); // idempotente

    const main = await testDb.location.findUniqueOrThrow({ where: { code: "MAIN" } });
    expect(main.isDefault).toBe(true);
    expect(
      await testDb.terminal.findFirst({ where: { name: "Caja 1", locationId: main.id } }),
    ).not.toBeNull();
    expect(await testDb.setting.findUnique({ where: { key: "tax.rate" } })).not.toBeNull();
    expect(await testDb.documentCounter.findUnique({ where: { key: "SALE" } })).not.toBeNull();
    for (const username of ["owner", "manager", "cashier", "warehouse"]) {
      expect(await testDb.user.findUnique({ where: { username } })).toBeNull();
    }
  });

  it("creates the owner with verifiable credentials and leaves an audit entry", async () => {
    await seedBase(testDb);
    const { id } = await createFirstOwner(input, testDb);

    const owner = await testDb.user.findUniqueOrThrow({ where: { id } });
    expect(owner).toMatchObject({ username: "rosa", name: "Rosa Martínez", role: "OWNER" });
    expect(owner.isActive).toBe(true);
    expect(await verifySecret(owner.passwordHash, input.password)).toBe(true);
    expect(await verifySecret(owner.pinHash ?? "", input.pin)).toBe(true);
    expect(owner.passwordHash).not.toContain(input.password);

    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "USER_CREATED", entityId: id },
    });
    expect(log.userId).toBe(id);
    expect(JSON.stringify(log.after)).not.toContain(input.password);

    // Puede entrar de verdad por el flujo normal de inicio de sesión
    const session = await login({ username: "rosa", password: input.password }, testDb);
    expect(session.user.role).toBe("OWNER");
    await expect(verifyPin(id, input.pin, testDb)).resolves.toMatchObject({ id });
  });

  it("works without a PIN", async () => {
    const { id } = await createFirstOwner({ ...input, pin: undefined }, testDb);
    expect((await testDb.user.findUniqueOrThrow({ where: { id } })).pinHash).toBeNull();
  });

  it("refuses to create a second owner and writes nothing", async () => {
    await createFirstOwner(input, testDb);
    await expect(
      createFirstOwner({ ...input, username: "otra", name: "Otra Persona" }, testDb),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await testDb.user.findUnique({ where: { username: "otra" } })).toBeNull();
  });

  it("allows it again when the only owner was deactivated", async () => {
    const first = await createFirstOwner(input, testDb);
    await testDb.user.update({ where: { id: first.id }, data: { isActive: false } });
    await expect(
      createFirstOwner({ ...input, username: "rescate", name: "Persona de Rescate" }, testDb),
    ).resolves.toHaveProperty("id");
  });

  it("rejects a short password, a bad username and a bad PIN before touching the database", async () => {
    for (const bad of [
      { ...input, password: "corta" },
      { ...input, username: "Mala Persona!" },
      { ...input, pin: "12" },
      { ...input, name: "" },
    ]) {
      await expect(createFirstOwner(bad, testDb)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await testDb.user.count()).toBe(0);
  });

  it("reports a taken username", async () => {
    await testDb.user.create({
      data: { name: "Ya existe", username: "rosa", passwordHash: "x", role: "CASHIER" },
    });
    await expect(createFirstOwner(input, testDb)).rejects.toBeInstanceOf(UsernameTakenError);
  });
});
