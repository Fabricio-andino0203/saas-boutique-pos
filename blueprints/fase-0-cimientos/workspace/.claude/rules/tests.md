---
description: Convenciones de pruebas unitarias, de integración y E2E
paths:
  - "tests/**"
---

# Reglas de pruebas

- `tests/unit` no abre conexiones de BD ni de red; `tests/integration` usa solo la base `boutique_pos_test` (vía `testDb` y `resetDatabase()` de `tests/integration/helpers/db.ts`, o vía `db` de `@/lib/db` cuando el proyecto `integration` fija `DATABASE_URL`).
- Cada archivo de integración cierra su cliente en `afterAll`: `closeDatabase()` si usa `testDb`, `db.$disconnect()` si usa `db`.
- Nunca se confirma `.only` ni `.skip`; `it.todo` es válido solo para invariantes documentados como pendientes.
- Los textos esperados se derivan a mano; no se afirman cadenas producidas por `Intl` ni por el motor de la base.
- Los datos de siembra se verifican por entidades con nombre (el usuario `cashier`, la ubicación `MAIN`), nunca por conteo de filas.
- Los tests importan con `@/` para `src/`; rutas relativas entre archivos de pruebas, hacia `prisma/` y en E2E; no usan `sleep` ni `waitForTimeout`; los E2E usan localizadores por rol o etiqueta.
- Los textos de la interfaz se leen de `src/config/messages.es.ts`, no se duplican en las pruebas.
