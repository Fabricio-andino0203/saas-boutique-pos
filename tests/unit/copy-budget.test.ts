import { describe, expect, it } from "vitest";

import { messages } from "@/config/messages.es";

/**
 * Presupuesto de texto de la interfaz (docs/UX.md §10, «Pantallas limpias»). No mide si un texto es bueno: avisa cuando el
 * conjunto vuelve a crecer sin que nadie lo haya decidido. Si una función nueva necesita más texto, se sube el tope en el mismo
 * cambio y se explica por qué; si no, se recorta otro.
 */
const BUDGET = {
  /** Todas las palabras de `messages.es.ts` (hoy ~7,700; antes de la limpieza eran 9,226). */
  words: 8_000,
  /** Palabras en ayudas y descripciones (claves `hint`, `description`, `intro`, `help`…): 2,159 antes de la limpieza. */
  helperWords: 1_250,
  /** Frases de más de 12 palabras: 162 antes de la limpieza. */
  longSentences: 60,
};

const wordsOf = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;
const isHelperKey = (key: string): boolean =>
  /(hint|description|intro|help|lead|explain)/i.test(key);

function collect(node: unknown, key: string, rows: { key: string; text: string }[]): void {
  if (typeof node === "string") {
    rows.push({ key, text: node });
  } else if (Array.isArray(node)) {
    for (const item of node) {
      collect(item, key, rows);
    }
  } else if (node && typeof node === "object") {
    for (const [childKey, value] of Object.entries(node)) {
      collect(value, childKey, rows);
    }
  }
}

describe("copy budget", () => {
  const rows: { key: string; text: string }[] = [];
  collect(messages, "", rows);

  const words = rows.reduce((sum, row) => sum + wordsOf(row.text), 0);
  const helperWords = rows
    .filter((row) => isHelperKey(row.key))
    .reduce((sum, row) => sum + wordsOf(row.text), 0);
  const longSentences = rows.filter((row) => wordsOf(row.text) > 12).length;

  it("keeps the whole interface under the word budget", () => {
    expect(words).toBeLessThanOrEqual(BUDGET.words);
  });

  it("keeps helper texts and descriptions under their budget", () => {
    expect(helperWords).toBeLessThanOrEqual(BUDGET.helperWords);
  });

  it("keeps long sentences (more than 12 words) under their budget", () => {
    expect(longSentences).toBeLessThanOrEqual(BUDGET.longSentences);
  });
});
