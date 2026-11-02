import { describe, expect, it } from "vitest";

import { buildEan13 } from "@/lib/barcode";
import { barcodeKind, barcodeSvg } from "@/lib/barcode-svg";
import { DEFAULT_LABEL_TEMPLATE, LABEL_TEMPLATE_SCHEMA } from "@/lib/settings";

describe("barcodeKind", () => {
  it("uses EAN-13 only for valid EAN-13 codes", () => {
    expect(barcodeKind("4006381333931")).toBe("ean13");
    expect(barcodeKind(buildEan13("200", 42))).toBe("ean13");
    expect(barcodeKind("4006381333932")).toBe("code128"); // dígito de control incorrecto
    expect(barcodeKind("7001")).toBe("code128");
    expect(barcodeKind("ABC-123")).toBe("code128");
  });
});

describe("barcodeSvg", () => {
  it("draws an SVG with bars for an EAN-13 and for a Code 128", () => {
    for (const code of [buildEan13("200", 7), "ABC-123", "7001"]) {
      const svg = barcodeSvg(code);
      expect(svg.startsWith("<svg"), code).toBe(true);
      expect(svg).toContain("viewBox");
      expect(svg).toContain("<path");
    }
  });

  it("draws different bars for different codes and the same bars for the same code", () => {
    expect(barcodeSvg("ABC-123")).toBe(barcodeSvg("ABC-123"));
    expect(barcodeSvg("ABC-123")).not.toBe(barcodeSvg("ABC-124"));
  });

  it("rejects empty, too long and non-printable text", () => {
    for (const bad of ["", "x".repeat(49), "tab\there", "ñandú", "línea\nnueva"]) {
      expect(() => barcodeSvg(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe("label template", () => {
  it("has a valid default", () => {
    expect(LABEL_TEMPLATE_SCHEMA.safeParse(DEFAULT_LABEL_TEMPLATE).success).toBe(true);
  });

  it("limits sizes, columns and gaps", () => {
    const base = DEFAULT_LABEL_TEMPLATE;
    const ok = (patch: object) => LABEL_TEMPLATE_SCHEMA.safeParse({ ...base, ...patch }).success;
    expect(ok({ widthMm: 20, heightMm: 15, columns: 6, gapMm: 10 })).toBe(true);
    expect(ok({ widthMm: 150, heightMm: 100, columns: 1, gapMm: 0 })).toBe(true);
    for (const patch of [
      { widthMm: 19 },
      { widthMm: 151 },
      { heightMm: 14 },
      { heightMm: 101 },
      { columns: 0 },
      { columns: 7 },
      { gapMm: -1 },
      { gapMm: 11 },
      { widthMm: 50.5 },
      { layout: "rollo" },
      { showName: "yes" },
    ]) {
      expect(ok(patch), JSON.stringify(patch)).toBe(false);
    }
  });
});

describe("barcodeSvg is safe to inject as HTML", () => {
  // La etiqueta se dibuja con `dangerouslySetInnerHTML`: si el texto del código llegara al SVG como marcado, quien pueda
  // escribir un código de barras (almacén) ejecutaría código en el navegador de quien imprime. La biblioteca dibuja el texto legible
  // como trazos, no como texto: esta prueba avisa si eso cambia.
  it("never carries the characters of a hostile code into the markup", () => {
    for (const code of [
      "<img src=x onerror=alert(1)>",
      '"><script>alert(1)</script>',
      "&lt;svg/onload=x&gt;",
    ]) {
      const svg = barcodeSvg(code);
      expect(svg).not.toMatch(/<(img|script|iframe|object|embed)\b/i);
      expect(svg).not.toMatch(/\bon\w+\s*=/i);
      expect(svg).not.toContain(code);
    }
  });
});
