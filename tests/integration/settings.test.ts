import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { isValidEan13 } from "@/lib/barcode";
import { localDateKey } from "@/lib/dates";
import {
  ActiveRangeExistsError,
  ForbiddenError,
  NotFoundError,
  RangeOverlapError,
  ValidationError,
} from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import { getSetting, setSetting } from "@/lib/settings";
import { createProduct } from "@/modules/products/service";
import { SAMPLE_PRODUCTS } from "@/modules/settings/sample-products";
import { hasSampleData, loadSampleData } from "@/modules/settings/sample-data";
import {
  createFiscalRange,
  getBusinessProfile,
  getSettingsSnapshot,
  listFiscalRanges,
  setFiscalRangeActive,
  updateBusinessProfile,
  updateSettings,
} from "@/modules/settings/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

type Actor = { id: string; role: Role };

async function world() {
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: username, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  const owner = await make("owner", "OWNER");
  const manager = await make("manager", "MANAGER");
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const terminal = await testDb.terminal.create({
    data: { name: "Caja 1", locationId: location.id },
  });
  return { owner, manager, location, terminal };
}

const range = (overrides: object = {}) => ({
  documentType: "INVOICE",
  cai: "A1B2C3-D4E5F6-A7B8C9-D0E1F2-A3B4C5-D6",
  prefix: "000-001-01-",
  rangeStart: 1,
  rangeEnd: 500,
  expiresAt: "2099-12-31",
  ...overrides,
});

describe("settings", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("returns the defaults when nothing is stored, and what is stored otherwise", async () => {
    const empty = await getSettingsSnapshot(testDb);
    expect(empty["tax.rate"]).toBe(1500);
    expect(empty["payments.enabled"]).toEqual(["CASH", "CARD", "TRANSFER", "OTHER"]);
    expect(empty["onboarding.completed"]).toBe(false);

    await setSetting(testDb, "returns.maxDays", 15);
    expect(await getSetting(testDb, "returns.maxDays")).toBe(15);
  });

  it("falls back to the default when the stored value is not valid", async () => {
    await testDb.setting.create({ data: { key: "tax.rate", valueJson: "quince" } });
    await testDb.setting.create({ data: { key: "returns.maxDays", valueJson: 5000 } });
    const snapshot = await getSettingsSnapshot(testDb);
    expect(snapshot["tax.rate"]).toBe(1500);
    expect(snapshot["returns.maxDays"]).toBe(8);
  });

  it("refuses to store an invalid value", async () => {
    await expect(setSetting(testDb, "tax.rate", 99999)).rejects.toThrow();
    expect(await testDb.setting.count()).toBe(0);
  });

  it("saves only what was sent and audits what really changed", async () => {
    const w = await world();
    const result = await updateSettings(
      w.owner,
      { "discount.maxPercent.CASHIER": 15, "returns.maxDays": 8, "tax.rate": 1500 },
      testDb,
    );

    expect(result.changed).toEqual(["discount.maxPercent.CASHIER"]);
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "SETTINGS_CHANGED" } });
    expect(log).toMatchObject({
      userId: w.owner.id,
      entityType: "Setting",
      before: { "discount.maxPercent.CASHIER": 10 },
      after: { "discount.maxPercent.CASHIER": 15 },
    });
    expect(await testDb.setting.count()).toBe(1);
  });

  it("does not audit when nothing changes", async () => {
    const w = await world();
    const result = await updateSettings(w.owner, { "returns.maxDays": 8 }, testDb);
    expect(result.changed).toEqual([]);
    expect(await testDb.auditLog.count()).toBe(0);
  });

  it("rejects unknown keys and out-of-range values without saving anything", async () => {
    const w = await world();
    await expect(updateSettings(w.owner, { "no.existe": 1 }, testDb)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      updateSettings(
        w.owner,
        { "returns.maxDays": 20, "discount.maxPercent.CASHIER": 500 },
        testDb,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await testDb.setting.count()).toBe(0);
  });

  it("is only for whoever manages settings", async () => {
    const w = await world();
    await expect(
      updateSettings(w.manager, { "returns.maxDays": 20 }, testDb),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateBusinessProfile(w.manager, { legalName: "X" }, testDb),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createFiscalRange(w.manager, range(), testDb)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(loadSampleData(w.manager, testDb)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("uses the configured barcode prefix for new variants", async () => {
    const w = await world();
    const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
    await updateSettings(w.owner, { "barcode.internalPrefix": "770" }, testDb);
    const { id } = await createProduct(
      w.owner,
      { name: "Blusa", categoryId: category.id, basePriceCents: 1000, code: "BLU1" },
      testDb,
    );
    const variant = await testDb.variant.findFirstOrThrow({ where: { productId: id } });
    expect(variant.barcode.startsWith("770")).toBe(true);
    expect(isValidEan13(variant.barcode)).toBe(true);
  });
});

describe("business profile", () => {
  beforeEach(resetDatabase);

  it("creates and updates the profile, auditing the change", async () => {
    const w = await world();
    expect(await getBusinessProfile(testDb)).toEqual({
      legalName: "",
      tradeName: "",
      taxId: "",
      address: "",
      phone: "",
    });

    await updateBusinessProfile(
      w.owner,
      { legalName: "Boutique Luna S. de R.L.", taxId: "08011999123456", phone: "2222-3333" },
      testDb,
    );
    await updateBusinessProfile(
      w.owner,
      { legalName: "Boutique Luna", tradeName: "Luna", address: "Col. Palmira" },
      testDb,
    );

    expect(await getBusinessProfile(testDb)).toEqual({
      legalName: "Boutique Luna",
      tradeName: "Luna",
      taxId: "",
      address: "Col. Palmira",
      phone: "",
    });
    expect(await testDb.businessProfile.count()).toBe(1);
    expect(await testDb.auditLog.count({ where: { entityType: "BusinessProfile" } })).toBe(2);
  });

  it("requires a business name", async () => {
    const w = await world();
    await expect(updateBusinessProfile(w.owner, { legalName: " " }, testDb)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("fiscal ranges", () => {
  beforeEach(resetDatabase);

  it("creates an active range that starts counting at its first number", async () => {
    const w = await world();
    const { id } = await createFiscalRange(w.owner, range(), testDb);
    const saved = await testDb.fiscalRange.findUniqueOrThrow({ where: { id } });
    expect(saved).toMatchObject({
      documentType: "INVOICE",
      terminalId: w.terminal.id,
      prefix: "000-001-01-",
      rangeStart: 1,
      rangeEnd: 500,
      nextNumber: 1,
      isActive: true,
    });
    expect(localDateKey(saved.expiresAt)).toBe("2099-12-31");
    expect(await testDb.auditLog.count({ where: { action: "FISCAL_RANGE_CHANGED" } })).toBe(1);

    const [row] = await listFiscalRanges(testDb);
    expect(row).toMatchObject({ terminalName: "Caja 1", expired: false, isActive: true });
  });

  it("rejects overlapping numbers in the same series, but not in another", async () => {
    const w = await world();
    await createFiscalRange(w.owner, range(), testDb);
    const first = await testDb.fiscalRange.findFirstOrThrow();
    await testDb.fiscalRange.update({ where: { id: first.id }, data: { isActive: false } });

    await expect(
      createFiscalRange(w.owner, range({ rangeStart: 500, rangeEnd: 900 }), testDb),
    ).rejects.toBeInstanceOf(RangeOverlapError);
    await expect(
      createFiscalRange(w.owner, range({ rangeStart: 501, rangeEnd: 900 }), testDb),
    ).resolves.toBeDefined();
    await expect(
      createFiscalRange(
        w.owner,
        range({ prefix: "000-002-01-", rangeStart: 1, rangeEnd: 50, documentType: "INVOICE" }),
        testDb,
      ),
    ).rejects.toBeInstanceOf(ActiveRangeExistsError);
  });

  it("allows one active range per document type and terminal", async () => {
    const w = await world();
    await createFiscalRange(w.owner, range(), testDb);
    await expect(
      createFiscalRange(w.owner, range({ rangeStart: 501, rangeEnd: 900 }), testDb),
    ).rejects.toBeInstanceOf(ActiveRangeExistsError);
    await expect(
      createFiscalRange(
        w.owner,
        range({ documentType: "CREDIT_NOTE", prefix: "000-001-03-" }),
        testDb,
      ),
    ).resolves.toBeDefined();
  });

  it("deactivates and reactivates, refusing a second active one", async () => {
    const w = await world();
    const a = await createFiscalRange(w.owner, range(), testDb);
    await setFiscalRangeActive(w.owner, a.id, false, testDb);
    const b = await createFiscalRange(w.owner, range({ rangeStart: 501, rangeEnd: 900 }), testDb);

    await expect(setFiscalRangeActive(w.owner, a.id, true, testDb)).rejects.toBeInstanceOf(
      ActiveRangeExistsError,
    );
    await setFiscalRangeActive(w.owner, b.id, false, testDb);
    await setFiscalRangeActive(w.owner, a.id, true, testDb);
    expect((await testDb.fiscalRange.findUniqueOrThrow({ where: { id: a.id } })).isActive).toBe(
      true,
    );
    await expect(setFiscalRangeActive(w.owner, "no-existe", true, testDb)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("rejects a bad CAI, reversed numbers, a past deadline and an unknown terminal", async () => {
    const w = await world();
    for (const bad of [
      range({ cai: "123" }),
      range({ rangeStart: 10, rangeEnd: 5 }),
      range({ expiresAt: "2020-01-01" }),
      range({ terminalId: "no-existe" }),
    ]) {
      await expect(
        createFiscalRange(w.owner, bad, testDb),
        JSON.stringify(bad),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await testDb.fiscalRange.count()).toBe(0);
  });

  it("marks ranges whose deadline has passed", async () => {
    const w = await world();
    await createFiscalRange(w.owner, range({ expiresAt: "2099-01-01" }), testDb);
    const [row] = await listFiscalRanges(testDb, new Date("2100-01-01T12:00:00Z"));
    expect(row?.expired).toBe(true);
  });
});

describe("sample data", () => {
  beforeEach(resetDatabase);

  it("creates the sample products with stock, and repeating it adds nothing", async () => {
    const w = await world();
    expect(await hasSampleData(testDb)).toBe(false);

    const first = await loadSampleData(w.owner, testDb);
    expect(first.created).toBe(SAMPLE_PRODUCTS.length);
    expect(await hasSampleData(testDb)).toBe(true);

    const products = await testDb.product.findMany({ include: { variants: true } });
    expect(products).toHaveLength(SAMPLE_PRODUCTS.length);
    const units = (await testDb.stockLevel.aggregate({ _sum: { onHand: true } }))._sum.onHand;
    const expected = SAMPLE_PRODUCTS.reduce(
      (sum, sample) =>
        sum +
        sample.quantity * Math.max(1, sample.sizes.length) * Math.max(1, sample.colors.length),
      0,
    );
    expect(units).toBe(expected);
    expect(await testDb.stockMovement.count({ where: { type: "INITIAL" } })).toBe(
      products.reduce((sum, product) => sum + product.variants.length, 0),
    );

    const second = await loadSampleData(w.owner, testDb);
    expect(second.created).toBe(0);
    expect(await testDb.product.count()).toBe(SAMPLE_PRODUCTS.length);
  });

  it("creates the categories, sizes and colors it needs", async () => {
    const w = await world();
    await loadSampleData(w.owner, testDb);
    expect(await testDb.category.findFirst({ where: { name: "Vestidos" } })).not.toBeNull();
    expect(await testDb.size.findUnique({ where: { name: "36" } })).not.toBeNull();
    expect(await testDb.color.findUnique({ where: { name: "Azul marino" } })).not.toBeNull();
    expect(await testDb.brand.findUnique({ where: { name: "Zara" } })).not.toBeNull();
  });
});
