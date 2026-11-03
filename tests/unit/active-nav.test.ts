import { describe, expect, it } from "vitest";

import { activeHref } from "@/components/layout/active-nav";
import { initialsOf } from "@/components/layout/user-avatar";

const HREFS = [
  "/",
  "/vender",
  "/caja",
  "/caja/cierres",
  "/productos",
  "/productos/fotos",
  "/inventario",
];

describe("activeHref", () => {
  it("marks the home only on the exact home page", () => {
    expect(activeHref("/", HREFS)).toBe("/");
    expect(activeHref("/vender", HREFS)).toBe("/vender");
  });

  it("marks the longest entry that contains the page, so a child page does not light up its parent", () => {
    expect(activeHref("/caja/cierres", HREFS)).toBe("/caja/cierres");
    expect(activeHref("/caja", HREFS)).toBe("/caja");
    expect(activeHref("/productos/fotos", HREFS)).toBe("/productos/fotos");
  });

  it("marks the section for a detail page below it", () => {
    expect(activeHref("/productos/abc123", HREFS)).toBe("/productos");
    expect(activeHref("/caja/cierres/xyz", HREFS)).toBe("/caja/cierres");
  });

  it("does not confuse a longer name that merely starts the same way", () => {
    expect(activeHref("/cajas-viejas", HREFS)).toBeNull();
    expect(activeHref("/productoss", HREFS)).toBeNull();
  });

  it("marks nothing for a page that is not in the menu", () => {
    expect(activeHref("/cuenta", HREFS)).toBeNull();
  });
});

describe("initialsOf", () => {
  it("uses the first letter of the first and last name", () => {
    expect(initialsOf("Ana Pérez Mora")).toBe("AM");
    expect(initialsOf("  carlos   ruiz ")).toBe("CR");
  });

  it("works with one name and with nothing", () => {
    expect(initialsOf("Propietario")).toBe("P");
    expect(initialsOf("   ")).toBe("?");
  });
});
