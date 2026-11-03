import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { themeScript } from "@/components/layout/theme-script";

// Los colores de la marca viven en globals.css. Esta prueba lee esos mismos valores y exige el contraste mínimo de WCAG 2.1
// (4.5:1 para texto, 3:1 para bordes de controles y para el anillo de enfoque) en el tema claro y en el oscuro.
const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const end = css.indexOf("}", start);
  const block = css.slice(start, end);
  const found: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6});/g)) {
    found[match[1]!] = match[2]!;
  }
  return found;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

// [color, fondo, mínimo]
const TEXT_PAIRS: readonly [string, string, number][] = [
  ["foreground", "background", 4.5],
  ["card-foreground", "card", 4.5],
  ["popover-foreground", "popover", 4.5],
  ["primary-foreground", "primary", 4.5],
  ["secondary-foreground", "secondary", 4.5],
  ["accent-foreground", "accent", 4.5],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "card", 4.5],
  ["muted-foreground", "muted", 4.5],
  ["primary", "background", 4.5],
  ["primary", "card", 4.5],
  ["heading", "background", 4.5],
  ["heading", "card", 4.5],
  ["destructive", "background", 4.5],
  ["success", "background", 4.5],
  ["warning", "background", 4.5],
  ["info", "background", 4.5],
  ["sidebar-foreground", "sidebar", 4.5],
  ["sidebar-primary-foreground", "sidebar-primary", 4.5],
  ["sidebar-accent-foreground", "sidebar-accent", 4.5],
  ["brand", "background", 3],
  ["border", "background", 3],
  ["border", "card", 3],
  ["input", "background", 3],
  ["input", "card", 3],
  ["ring", "background", 3],
];

describe.each([
  ["claro", ":root"],
  ["oscuro", ".dark"],
] as const)("contraste del tema %s", (_name, selector) => {
  const palette = tokens(selector);

  it("define todos los colores que se comprueban", () => {
    for (const [color, background] of TEXT_PAIRS) {
      expect(palette[color], color).toBeDefined();
      expect(palette[background], background).toBeDefined();
    }
  });

  it.each(TEXT_PAIRS)("%s sobre %s llega a %s:1", (color, background, minimum) => {
    expect(contrast(palette[color]!, palette[background]!)).toBeGreaterThanOrEqual(minimum);
  });
});

describe("script de tema", () => {
  // Se ejecuta antes de pintar, en un navegador sin React: aquí se corre con documento y almacenamiento falsos.
  function run(stored: string | null, prefersDark: boolean): boolean {
    const classes = new Set<string>();
    const fakeWindow = {
      localStorage: { getItem: () => stored },
      matchMedia: () => ({ matches: prefersDark }),
      document: {
        documentElement: {
          classList: {
            toggle: (name: string, force: boolean) =>
              force ? classes.add(name) : classes.delete(name),
          },
        },
      },
    };
    new Function("localStorage", "window", "document", themeScript)(
      fakeWindow.localStorage,
      fakeWindow,
      fakeWindow.document,
    );
    return classes.has("dark");
  }

  it("sin elección sigue al sistema", () => {
    expect(run(null, true)).toBe(true);
    expect(run(null, false)).toBe(false);
  });

  it("la elección guardada manda sobre el sistema", () => {
    expect(run("dark", false)).toBe(true);
    expect(run("light", true)).toBe(false);
  });

  it("un almacenamiento que falla deja el tema claro sin romper la página", () => {
    const broken = new Function("localStorage", "window", "document", themeScript);
    expect(() =>
      broken(
        {
          getItem: () => {
            throw new Error("bloqueado");
          },
        },
        { matchMedia: () => ({ matches: true }) },
        { documentElement: { classList: { toggle: () => undefined } } },
      ),
    ).not.toThrow();
  });
});
