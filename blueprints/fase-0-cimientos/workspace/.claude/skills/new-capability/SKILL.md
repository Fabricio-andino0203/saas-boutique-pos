---
name: new-capability
description: Procedimiento para agregar una capacidad nueva o cambiar qué rol la tiene en src/lib/permissions.ts. Úsala cuando alguien pida un permiso nuevo, mover una capacidad entre Propietario, Gerente, Cajero o Almacén, o autorizar un override con PIN de gerente.
---

# Agregar o cambiar una capacidad

## Cuándo usarla

- Aparece una acción nueva que necesita permiso (por ejemplo `inventory.view`).
- Hay que mover una capacidad entre roles o permitir un override con PIN de gerente.

## Pasos

1. Actualiza primero la matriz de permisos en `docs/PRD.md` §2 y el cambio de producto que la justifica.
2. Agrega el nombre a `CAPABILITIES` en `src/lib/permissions.ts` con formato `dominio.accion`.
3. Asígnala en `ROLE_CAPABILITIES` solo a los roles que corresponden. `OWNER` las tiene todas.
4. Si un gerente puede autorizarla con PIN, agrégala a `MANAGER_PIN_OVERRIDES`; esa capacidad debe estar en `MANAGER` y `OWNER` y ausente en `CASHIER`.
5. Agrega la fila a la matriz literal de `tests/unit/permissions.test.ts` (cuatro columnas, una por rol).
6. Aplica `requireCapability(actor, capacidad)` en la server action o query que la usa; nunca confíes en ocultar un botón.

## Verificar

```bash
pnpm test:unit        # esperado: exit 0 (cada celda de la matriz)
pnpm typecheck        # esperado: exit 0 (una capacidad inexistente es error de tipos)
```

## No hacer

- No comprobar roles con `if (role === ...)` fuera de `permissions.ts`; usa capacidades.
- No dejar una capacidad sin fila en la prueba de la matriz.
