---
description: Reglas de dinero, redondeo y formato
paths:
  - "src/lib/money*.ts"
  - "src/lib/format.ts"
  - "tests/unit/money*.test.ts"
  - "tests/unit/format.test.ts"
---

# Reglas de dinero

- Todo valor monetario es un entero de centavos con el tipo `Cents`; ningún `number` con decimales representa dinero.
- Redondeo: mitad hacia afuera del cero, una sola vez por valor calculado, con el helper único de `src/lib/money.ts`.
- `src/lib/money.ts` no formatea texto; `src/lib/format.ts` no calcula. El signo negativo se escribe con U+2212 (`−`).
- Las funciones lanzan `ValidationError` ante decimales, NaN, Infinity o enteros no seguros.
- Cada función nueva lleva pruebas con literales derivados a mano; los umbrales de cobertura de `src/lib/money.ts` son 100 % líneas, sentencias y funciones, 95 % ramas.
- Las pruebas de propiedades usan `mulberry32` con semilla fija (`tests/unit/helpers/prng.ts`); no se agrega `fast-check`.
