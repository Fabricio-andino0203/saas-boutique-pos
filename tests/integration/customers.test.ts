import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  CustomerInUseError,
  ForbiddenError,
  NotFoundError,
  PhoneTakenError,
  ValidationError,
} from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import { openCashSession } from "@/modules/cash/service";
import { getCustomerForEdit, listCustomers, searchCustomers } from "@/modules/customers/queries";
import { createCustomer, setCustomerArchived, updateCustomer } from "@/modules/customers/service";
import { recordMovement } from "@/modules/inventory/service";
import { createLayaway } from "@/modules/layaways/service";
import { completeSale } from "@/modules/sales/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const closeAll = async () => {
  await db.$disconnect();
  await closeDatabase();
};

type Actor = { id: string; role: Role };

async function people() {
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: `Nombre ${username}`, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  return {
    owner: await make("owner", "OWNER"),
    manager: await make("manager", "MANAGER"),
    cashier: await make("cashier", "CASHIER"),
    warehouse: await make("warehouse", "WAREHOUSE"),
  };
}

const full = {
  name: "Ana Pérez",
  phone: "9999-0000",
  email: "ana@correo.com",
  taxId: "0801-1990-12345",
  notes: "Prefiere vestidos",
  preferredSizes: "M en blusas",
};

describe("createCustomer", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("saves the whole file, leaves empty fields empty and records who created it", async () => {
    const p = await people();
    const { id } = await createCustomer(p.cashier, full, testDb);
    expect(await getCustomerForEdit(id)).toMatchObject({ ...full, archivedAt: null });

    const minimal = await createCustomer(
      p.cashier,
      { name: "  Luis  ", phone: "", email: " ", notes: "" },
      testDb,
    );
    expect(await getCustomerForEdit(minimal.id)).toMatchObject({
      name: "Luis",
      phone: null,
      email: null,
      taxId: null,
      notes: null,
      preferredSizes: null,
    });
    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "CUSTOMER_CREATED", entityId: id },
    });
    expect(log).toMatchObject({ userId: p.cashier.id, entityType: "Customer" });
    expect(log.after).toMatchObject({ name: "Ana Pérez", phone: "9999-0000" });
  });

  it("is for people who can write customers, with valid data and a phone that is not taken", async () => {
    const p = await people();
    await expect(createCustomer(p.warehouse, full, testDb)).rejects.toBeInstanceOf(ForbiddenError);
    for (const bad of [
      { name: "A" },
      { phone: "12" },
      { phone: "abc-defg" },
      { email: "no-es-correo" },
    ]) {
      await expect(createCustomer(p.manager, { ...full, ...bad }, testDb)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await createCustomer(p.manager, full, testDb);
    await expect(
      createCustomer(p.manager, { ...full, name: "Otra Ana" }, testDb),
    ).rejects.toBeInstanceOf(PhoneTakenError);
    // tampoco con un cliente archivado
    const other = await createCustomer(p.manager, { name: "Luis", phone: "8888-0000" }, testDb);
    await setCustomerArchived(p.manager, other.id, true, testDb);
    await expect(
      createCustomer(p.manager, { name: "Luis Dos", phone: "8888-0000" }, testDb),
    ).rejects.toBeInstanceOf(PhoneTakenError);
    expect(await testDb.customer.count()).toBe(2);
  });
});

describe("updateCustomer", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("changes and clears fields and keeps how it was in the audit log", async () => {
    const p = await people();
    const { id } = await createCustomer(p.manager, full, testDb);
    await updateCustomer(
      p.cashier,
      id,
      { name: "Ana María Pérez", phone: "9999-0000", email: "", taxId: "0801-1990-12345" },
      testDb,
    );
    expect(await getCustomerForEdit(id)).toMatchObject({
      name: "Ana María Pérez",
      phone: "9999-0000",
      email: null,
      notes: null,
      preferredSizes: null,
    });
    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "CUSTOMER_UPDATED", entityId: id },
    });
    expect(log.userId).toBe(p.cashier.id);
    expect(log.before).toMatchObject({
      name: "Ana Pérez",
      email: "ana@correo.com",
      notes: "Prefiere vestidos",
    });
    expect(log.after).toMatchObject({ name: "Ana María Pérez", email: null, notes: null });
  });

  it("refuses a phone that belongs to someone else, an unknown customer and a warehouse user", async () => {
    const p = await people();
    const ana = await createCustomer(p.manager, full, testDb);
    const luis = await createCustomer(p.manager, { name: "Luis", phone: "8888-0000" }, testDb);
    await expect(
      updateCustomer(p.manager, luis.id, { name: "Luis", phone: "9999-0000" }, testDb),
    ).rejects.toBeInstanceOf(PhoneTakenError);
    await expect(
      updateCustomer(p.manager, "no-existe", { name: "Luis" }, testDb),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateCustomer(p.warehouse, ana.id, { name: "Ana" }, testDb),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getCustomerForEdit(luis.id))?.phone).toBe("8888-0000");
  });
});

describe("setCustomerArchived", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("archives and restores with a trace, and only managers can", async () => {
    const p = await people();
    const { id } = await createCustomer(p.manager, full, testDb);
    await expect(setCustomerArchived(p.cashier, id, true, testDb)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    await setCustomerArchived(p.manager, id, true, testDb);
    expect((await getCustomerForEdit(id))?.archivedAt).not.toBeNull();
    // Archivar dos veces no deja otra huella
    await setCustomerArchived(p.manager, id, true, testDb);
    expect(
      await testDb.auditLog.count({ where: { action: "CUSTOMER_ARCHIVED", entityId: id } }),
    ).toBe(1);

    await setCustomerArchived(p.owner, id, false, testDb);
    expect((await getCustomerForEdit(id))?.archivedAt).toBeNull();
    expect(
      await testDb.auditLog.count({ where: { action: "CUSTOMER_RESTORED", entityId: id } }),
    ).toBe(1);
    await expect(setCustomerArchived(p.manager, "no-existe", true, testDb)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("does not archive a customer with an active layaway", async () => {
    const p = await people();
    const location = await testDb.location.create({
      data: { code: "MAIN", name: "Tienda principal", isDefault: true },
    });
    await testDb.terminal.create({ data: { name: "Caja 1", locationId: location.id } });
    const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
    const product = await testDb.product.create({
      data: { code: "V1", name: "Vestido", categoryId: category.id, basePriceCents: 10000 },
    });
    const variant = await testDb.variant.create({
      data: { productId: product.id, sku: "V1", barcode: "BC-V1" },
    });
    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: variant.id,
        locationId: location.id,
        userId: p.owner.id,
        type: "INITIAL",
        quantity: 5,
      }),
    );
    await openCashSession(p.cashier, { openingFloatCents: 0 }, testDb);
    const { id } = await createCustomer(p.manager, full, testDb);
    await createLayaway(
      p.cashier,
      {
        clientRequestId: "request-customers-1",
        customerId: id,
        lines: [{ variantId: variant.id, quantity: 1 }],
        deposit: { method: "CASH", amountCents: 2000 },
      },
      testDb,
    );
    await expect(setCustomerArchived(p.manager, id, true, testDb)).rejects.toBeInstanceOf(
      CustomerInUseError,
    );
    expect((await getCustomerForEdit(id))?.archivedAt).toBeNull();
  });
});

describe("listCustomers and searchCustomers", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("lists by name, searches name, phone and email, pages and hides the archived", async () => {
    const p = await people();
    for (let index = 1; index <= 30; index += 1) {
      await createCustomer(
        p.manager,
        {
          name: `Cliente ${String(index).padStart(2, "0")}`,
          phone: `7000-00${String(index).padStart(2, "0")}`,
          ...(index === 7 ? { email: "siete@correo.com" } : {}),
        },
        testDb,
      );
    }
    const first = await listCustomers({});
    expect(first).toMatchObject({ total: 30, page: 1, pageSize: 25 });
    expect(first.rows).toHaveLength(25);
    expect(first.rows[0]?.name).toBe("Cliente 01");
    expect((await listCustomers({ page: 2 })).rows.map((r) => r.name)).toEqual([
      "Cliente 26",
      "Cliente 27",
      "Cliente 28",
      "Cliente 29",
      "Cliente 30",
    ]);
    expect((await listCustomers({ q: "cliente 1" })).rows.map((r) => r.name)).toEqual([
      "Cliente 10",
      "Cliente 11",
      "Cliente 12",
      "Cliente 13",
      "Cliente 14",
      "Cliente 15",
      "Cliente 16",
      "Cliente 17",
      "Cliente 18",
      "Cliente 19",
    ]);
    expect((await listCustomers({ q: "7000-0012" })).rows.map((r) => r.name)).toEqual([
      "Cliente 12",
    ]);
    expect((await listCustomers({ q: "SIETE@" })).rows.map((r) => r.name)).toEqual(["Cliente 07"]);

    const archived = (await listCustomers({ q: "Cliente 05" })).rows[0]!;
    await setCustomerArchived(p.manager, archived.id, true, testDb);
    expect((await listCustomers({})).total).toBe(29);
    const everyone = await listCustomers({ includeArchived: true });
    expect(everyone.total).toBe(30);
    expect(everyone.rows.find((row) => row.id === archived.id)?.archived).toBe(true);
  });

  it("finds customers for the counter: two letters at least, up to eight, never archived", async () => {
    const p = await people();
    for (let index = 1; index <= 10; index += 1) {
      await createCustomer(
        p.manager,
        { name: `María ${index}`, phone: `6000-000${index}` },
        testDb,
      );
    }
    expect(await searchCustomers("m")).toEqual([]);
    expect(await searchCustomers(" ")).toEqual([]);
    const found = await searchCustomers("mar");
    expect(found).toHaveLength(8);
    expect(found[0]).toMatchObject({ name: "María 1", phone: "6000-0001" });
    expect((await searchCustomers("6000-0009")).map((c) => c.name)).toEqual(["María 9"]);
    const nine = await testDb.customer.findFirstOrThrow({ where: { name: "María 9" } });
    await setCustomerArchived(p.manager, nine.id, true, testDb);
    expect(await searchCustomers("6000-0009")).toEqual([]);
  });

  it("shows how many purchases each customer has and when the last one was", async () => {
    const p = await people();
    const location = await testDb.location.create({
      data: { code: "MAIN", name: "Tienda principal", isDefault: true },
    });
    await testDb.terminal.create({ data: { name: "Caja 1", locationId: location.id } });
    const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
    const product = await testDb.product.create({
      data: { code: "V1", name: "Vestido", categoryId: category.id, basePriceCents: 10000 },
    });
    const variant = await testDb.variant.create({
      data: { productId: product.id, sku: "V1", barcode: "BC-V1" },
    });
    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: variant.id,
        locationId: location.id,
        userId: p.owner.id,
        type: "INITIAL",
        quantity: 5,
      }),
    );
    await openCashSession(p.cashier, { openingFloatCents: 0 }, testDb);
    const ana = await createCustomer(p.manager, full, testDb);
    await createCustomer(p.manager, { name: "Luis" }, testDb);
    for (const request of ["request-customers-2", "request-customers-3"]) {
      await completeSale(
        p.cashier,
        {
          clientRequestId: request,
          lines: [{ variantId: variant.id, quantity: 1 }],
          payments: [{ method: "CASH", amountCents: 10000 }],
          customerId: ana.id,
        },
        testDb,
      );
    }
    const rows = (await listCustomers({})).rows;
    expect(rows.find((row) => row.name === "Ana Pérez")).toMatchObject({ salesCount: 2 });
    expect(rows.find((row) => row.name === "Ana Pérez")?.lastSaleAt).toBeInstanceOf(Date);
    expect(rows.find((row) => row.name === "Luis")).toMatchObject({
      salesCount: 0,
      lastSaleAt: null,
    });
  });
});
