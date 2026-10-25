---
name: money-change-checklist
description: Lista de pasos para cualquier cambio en src/lib/money.ts, src/lib/format.ts o en código que calcule precios, descuentos, ISV, totales o prorrateos. Úsala cuando toques centavos, redondeo, extractTax, allocate, prorateDiscount, parseMoney o formatMoney.
---

# Checklist de cambios de dinero

## Cuándo usarla

- Vas a agregar o modificar una función de `src/lib/money.ts` o `src/lib/format.ts`.
- Vas a escribir código de servicio que suma, multiplica, porcentúa, extrae ISV o reparte un descuento.

## Pasos

1. Trabaja siempre en enteros de centavos (`Cents`). Nunca `parseFloat`, `toFixed` ni decimales en aritmética.
2. Toda operación pasa por `src/lib/money.ts`. El texto (`L 1,234.50`) se produce solo en `src/lib/format.ts`.
3. Redondeo: mitad hacia afuera del cero (`roundHalfAwayFromZero`), aplicado una sola vez por valor calculado.
4. Escribe primero la prueba con literales derivados a mano y anota la derivación en un comentario corto.
5. Si el cambio reparte un total entre líneas, usa `allocate` (mayor residuo, empate al índice más bajo) y verifica que la suma de las partes sea igual al total.
6. Si cambias una regla de redondeo o de ISV, actualiza `docs/ARCHITECTURE.md` §6 y registra la decisión en §12.

## Verificar

```bash
pnpm test:unit        # esperado: exit 0
pnpm test:coverage    # esperado: exit 0 con los umbrales por archivo de src/lib/money.ts
pnpm typecheck        # esperado: exit 0
```

## No hacer

- No devolver ni aceptar `number` con decimales como si fueran dinero.
- No redondear dos veces el mismo valor ni redondear cada parte de un reparto por separado.
- No bajar los umbrales de cobertura de `src/lib/money.ts` para que pase una prueba.
