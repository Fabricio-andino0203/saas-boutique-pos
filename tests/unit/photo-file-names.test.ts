import { describe, expect, it } from "vitest";

import {
  baseName,
  candidatesFromFileName,
  colorFromRest,
  compareFileNames,
  normalizeName,
} from "@/modules/photos/file-names";

describe("baseName", () => {
  it.each([
    ["VES-001.jpg", "VES-001"],
    ["C:\\fotos\\VES-001.JPG", "VES-001"],
    ["/home/u/fotos/VES-001.png", "VES-001"],
    ["  VES-001 .webp", "VES-001"],
    ["sin-extension", "sin-extension"],
    ["archivo.tar.gz", "archivo.tar"],
    [".jpg", ""],
    ["", ""],
  ])("%s → %s", (name, expected) => {
    expect(baseName(name)).toBe(expected);
  });
});

describe("candidatesFromFileName", () => {
  it("proposes the whole name first, because a code can have hyphens", () => {
    expect(candidatesFromFileName("CAM-001.jpg")[0]).toEqual({ code: "CAM-001", rest: "" });
  });

  it("then every cut at a space, hyphen or underscore, longest code first", () => {
    expect(candidatesFromFileName("CAM-001_rojo.jpg")).toEqual([
      { code: "CAM-001_rojo", rest: "" },
      { code: "CAM-001", rest: "rojo" },
      { code: "CAM", rest: "001_rojo" },
    ]);
  });

  it("understands an order number in parentheses", () => {
    expect(candidatesFromFileName("VES1 (2).jpg")).toContainEqual({ code: "VES1", rest: "(2)" });
  });

  it("does not repeat a code or exceed the limit", () => {
    const many = candidatesFromFileName("a-b-c-d-e-f-g-h-i-j-k-l.jpg");
    expect(many.length).toBeLessThanOrEqual(8);
    const codes = many.map((candidate) => candidate.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has nothing to propose for a name without text", () => {
    expect(candidatesFromFileName(".jpg")).toEqual([]);
    expect(candidatesFromFileName("")).toEqual([]);
  });
});

describe("normalizeName", () => {
  it("ignores case and accents", () => {
    expect(normalizeName("  Púrpura ")).toBe("purpura");
    expect(normalizeName("AZUL")).toBe("azul");
  });
});

describe("colorFromRest", () => {
  const colors = [
    { id: "1", name: "Rojo" },
    { id: "2", name: "Azul" },
    { id: "3", name: "Azul marino" },
    { id: "4", name: "Púrpura" },
  ];

  it.each([
    ["rojo", "1"],
    ["ROJO", "1"],
    ["purpura", "4"],
    ["azul marino", "3"],
    ["azul_marino", "3"],
    ["azul", "2"],
    ["rojo vista 2", "1"],
    ["(rojo)", "1"],
  ])("'%s' is the color %s", (rest, id) => {
    expect(colorFromRest(rest, colors)?.id).toBe(id);
  });

  it.each([["2"], ["(3)"], [""], ["espalda"], ["verde"], ["   "]])(
    "'%s' does not name a color of the product",
    (rest) => {
      expect(colorFromRest(rest, colors)).toBeNull();
    },
  );

  it("prefers the longer color name when two start the same", () => {
    expect(colorFromRest("azul marino frente", colors)?.id).toBe("3");
  });
});

describe("compareFileNames", () => {
  it("sorts numbers the way a person counts", () => {
    const sorted = ["VES_10.jpg", "VES_2.jpg", "VES.jpg", "VES_1.jpg"].sort(compareFileNames);
    expect(sorted).toEqual(["VES.jpg", "VES_1.jpg", "VES_2.jpg", "VES_10.jpg"]);
  });
});
