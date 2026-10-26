import { describe, expect, it } from "vitest";

import { messages } from "@/config/messages.es";
import { slugify } from "@/lib/slug";
import {
  CATALOG_CONFIG,
  CATALOG_ENTITIES,
  columnLabel,
  isCatalogEntity,
} from "@/modules/catalog/config";
import { catalogSchemas } from "@/modules/catalog/schemas";

describe("slugify", () => {
  it.each([
    ["Vestidos de Fiesta", "vestidos-de-fiesta"],
    ["Niños", "ninos"],
    ["  Ropa / Interior!! ", "ropa-interior"],
    ["Mujer-Blusas", "mujer-blusas"],
    ["", ""],
    ["¡¡¡", ""],
  ])("%j → %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe("catalog configuration", () => {
  it("recognizes only known entities", () => {
    for (const entity of CATALOG_ENTITIES) expect(isCatalogEntity(entity)).toBe(true);
    for (const bad of ["products", "", "BRANDS", "constructor"]) {
      expect(isCatalogEntity(bad), bad).toBe(false);
    }
  });

  it("has Spanish labels for every entity, field and column", () => {
    for (const entity of CATALOG_ENTITIES) {
      const labels = messages.catalog.entities[entity];
      for (const text of Object.values(labels)) expect(text.trim().length).toBeGreaterThan(0);

      const config = CATALOG_CONFIG[entity];
      for (const field of config.fields) {
        expect(field.label, `${entity}.${field.name}`).not.toBe("");
        expect(field.name in catalogSchemas[entity].shape || entity === "seasons").toBe(true);
      }
      for (const column of config.columns) {
        expect(columnLabel(column), `${entity}.${column}`).not.toBe(column);
      }
    }
  });

  it("asks for product.write, except suppliers which need purchase.receive", () => {
    expect(CATALOG_CONFIG.suppliers.capability).toBe("purchase.receive");
    for (const entity of CATALOG_ENTITIES.filter((e) => e !== "suppliers")) {
      expect(CATALOG_CONFIG[entity].capability).toBe("product.write");
    }
  });
});

describe("catalog schemas", () => {
  it("requires a name everywhere", () => {
    for (const entity of CATALOG_ENTITIES) {
      expect(catalogSchemas[entity].safeParse({ name: "  " }).success, entity).toBe(false);
    }
  });

  it("normalizes colors and defaults the order", () => {
    const parsed = catalogSchemas.colors.parse({ name: "Rojo", hex: "#b42318", sortOrder: "" });
    expect(parsed).toMatchObject({ name: "Rojo", hex: "#B42318", sortOrder: 0 });
    expect(catalogSchemas.colors.parse({ name: "Sin hex", hex: "" }).hex).toBeUndefined();
    for (const bad of ["rojo", "#12345", "#GGGGGG", "B42318"]) {
      expect(catalogSchemas.colors.safeParse({ name: "X", hex: bad }).success, bad).toBe(false);
    }
  });

  it("accepts only whole, non-negative orders", () => {
    expect(catalogSchemas.sizes.parse({ name: "M", sortOrder: "12" }).sortOrder).toBe(12);
    for (const bad of ["-1", "1.5", "abc"]) {
      expect(catalogSchemas.sizes.safeParse({ name: "M", sortOrder: bad }).success, bad).toBe(
        false,
      );
    }
  });

  it("validates season dates and their order", () => {
    expect(
      catalogSchemas.seasons.safeParse({
        name: "PV26",
        startsAt: "2026-03-01",
        endsAt: "2026-08-31",
      }).success,
    ).toBe(true);
    expect(catalogSchemas.seasons.safeParse({ name: "PV26" }).success).toBe(true);
    expect(catalogSchemas.seasons.safeParse({ name: "PV26", startsAt: "2026-02-30" }).success).toBe(
      false,
    );
    expect(
      catalogSchemas.seasons.safeParse({
        name: "PV26",
        startsAt: "2026-09-01",
        endsAt: "2026-03-01",
      }).success,
    ).toBe(false);
  });

  it("turns the returns checkbox into a boolean", () => {
    expect(
      catalogSchemas.categories.parse({ name: "A", allowsReturns: "true" }).allowsReturns,
    ).toBe(true);
    expect(catalogSchemas.categories.parse({ name: "A", allowsReturns: "" }).allowsReturns).toBe(
      false,
    );
  });

  it("treats blank supplier fields as missing and validates the email", () => {
    const parsed = catalogSchemas.suppliers.parse({ name: "Textiles SA", email: "", phone: " " });
    expect(parsed.email).toBeUndefined();
    expect(parsed.phone).toBeUndefined();
    expect(catalogSchemas.suppliers.safeParse({ name: "X", email: "no-es-correo" }).success).toBe(
      false,
    );
    expect(
      catalogSchemas.suppliers.safeParse({ name: "X", email: "ventas@textiles.hn" }).success,
    ).toBe(true);
  });
});
