# SaaS multi-negocio — Etapa 4: planes, suscripciones, límites y módulos

> Rama `saas/etapa-0` (la Etapa 4 se construye encima). Propuesta aprobada: [`SAAS_PROPUESTA.md`](SAAS_PROPUESTA.md). Informes anteriores: [`SAAS_ETAPA_0.md`](SAAS_ETAPA_0.md), [`SAAS_ETAPA_1.md`](SAAS_ETAPA_1.md), [`SAAS_ETAPA_2.md`](SAAS_ETAPA_2.md), [`SAAS_ETAPA_3.md`](SAAS_ETAPA_3.md). Operación: [`RUNBOOK.md`](RUNBOOK.md) §15.
>
> **Criterio de la etapa:** «un negocio vence y pasa por gracia → solo lectura → se reactiva al pagar; cambio de plan sin perder datos» — **cumplido y probado** (secciones 3, 5 y 8).

## 1. Qué se entregó

| Pieza | Dónde | Para qué |
| --- | --- | --- |
| Planes | `src/modules/platform/billing.ts`, `/planes` en el panel | Lo que se vende: precio, cada cuánto se cobra (mensual a anual), **límites** (usuarios, productos) y **módulos** (reportes, apartados, devoluciones, compras, conteos, etiquetas, clientes, facturación con CAI). Los planes no se borran: se desactivan. |
| Suscripciones | ídem; sección «Suscripción» del detalle de cada negocio | Liga un negocio con un plan y dice hasta cuándo está pagado. El **historial no se edita**: cambiar de plan cierra la fila vieja y abre otra; el precio acordado queda copiado y no cambia si después editas el plan. |
| Pagos manuales | ídem, `registerPayment` | Registras el pago (efectivo, transferencia, tarjeta, otro) y el vencimiento se extiende. **Los pagos solo se insertan**: un trigger de la base impide editarlos o borrarlos. |
| Estados por fecha | `src/lib/tenancy/billing.ts` | Al corriente → **gracia** (7 días, todo funciona con aviso) → **solo lectura** (60 días) → **cancelada** (sin acceso; se pide la baja con 30 días de retención). El estado se **calcula con la hora en cada petición**; no depende de que corra ningún trabajo. |
| Corte por módulo | `src/proxy.ts`, `src/config/plan-catalog.ts` | Una pantalla (o el endpoint que recibe lo que envía) de un módulo que el plan no incluye responde «No incluido en tu plan» antes de leer la sesión. |
| Corte de escrituras | `src/lib/tenancy/read-only-guard.ts`, `resolver.ts` | En solo lectura, **ninguna escritura sobre datos del negocio llega a la base**, sin importar qué pantalla o acción la pida (se corta en `db`, por donde pasa todo). |
| Capacidades y módulos | `src/lib/auth.ts`, `src/lib/entitlements.ts` | Una acción cuya capacidad pertenece a un módulo no comprado (p. ej. crear un apartado desde el punto de venta) se rechaza en el servidor aunque el botón estuviera a la vista. |
| Límites al crear | usuarios y productos | Crear (y reactivar, restaurar, duplicar, importar) respeta el tope del plan. Un plan con menos tope que el uso actual **no borra nada**: solo impide agregar. |
| Avisos | franja en la tienda; «Suscripciones que piden atención» en el Resumen del panel | La tienda ve «vence el…», «en gracia hasta…» o «solo lectura»; quien opera ve, por urgencia, qué negocios vencen, están en gracia, en solo lectura o cancelados. |
| Barrido diario | `sweepSubscriptions`, `pnpm billing:sweep` | Anota los cambios de estado, deja la auditoría y **pide la baja** (reversible) de los negocios cancelados. Se repite sin efecto. Corre al arrancar y una vez al día (RUNBOOK §15). |
| Alta con plan | `provisioning.ts`, `tenants:provision --plan` | El negocio nuevo arranca en **prueba** del plan elegido, en la misma transacción que lo activa. |
| Comandos | `scripts/billing.ts` | `billing:sweep`, `seed-plans`, `plans`, `status`, `assign`, `pay`. |
| Esquema central | `prisma/control/migrations` (2) | `Plan`, `Subscription`, `PlatformPayment` con sus restricciones en la base (precios, fechas, plazos, **una sola suscripción vigente por negocio**, pagos de solo inserción). |

Lo que **no** cambia: ninguna regla de ventas, inventario, caja ni reportes; ninguna tabla ni migración de un negocio; con `TENANCY_MODE=single` el sistema es idéntico al de antes. **Un negocio sin plan no tiene ninguna restricción** (es el caso de la tienda #1 hasta que le asignes uno).

## 2. Cómo verlo funcionando (en tu equipo)

En PowerShell, con la plataforma preparada como en la Etapa 3:

```powershell
$env:TENANCY_MODE = "multi"; $env:PLATFORM_HOST = "admin.localhost"
pnpm control:setup                 # aplica las migraciones nuevas de la base central
pnpm billing:seed-plans            # crea Básico, Estándar y Completo (ajústalos a tus precios)
pnpm dev
```

1. `http://admin.localhost:3000` → **Planes**: los tres de ejemplo; **Nuevo plan** o **Editar** para cambiar precio, límites y módulos.
2. **Negocios → (un negocio) → Suscripción → Asignar plan**: elige un plan, «Ya vigente» y un vencimiento de hace 20 días. El negocio queda en **solo lectura**.
3. Entra al negocio (`http://tienda-b.localhost:3000`): verás la franja de solo lectura; el menú no ofrece lo que el plan no incluye; puedes consultar, pero crear un usuario o vender dice que la cuenta está en solo lectura.
4. En el panel, **Registrar pago**: el negocio vuelve a trabajar en segundos, sin perder nada. Prueba también **Cambiar plan** y **Ajustar vencimiento**.
5. **Auditoría** muestra cada paso (plan creado, asignado, pago registrado…).

## 3. El ciclo de vida

```
        pago                 vence                +7 días de gracia           +60 días
 ───── al corriente ─────▶ ┌─ gracia ─────────▶ ┌─ solo lectura ───────────▶ ┌─ cancelada ──▶ baja pedida
 (prueba o pagada)         │  todo funciona,     │  consultar y exportar,     │  sin acceso;   (30 días de
                           │  con aviso          │  nada nuevo                │  «suscripción  retención;
                           │                     │                            │  vencida»      reversible)
        ◀──────────────────┴─────────────────────┴────────────────────────────┘
                          un pago lo devuelve al corriente (y cancela la baja que pidió el sistema)
```

- Las fronteras son **inclusivas** (`ahora ≤ vencimiento` = al corriente) y todo está en UTC; los plazos (gracia 7, solo lectura 60, retención 30, prueba 14) son los valores por omisión de la propuesta y se ajustan **por suscripción** («Ajustar vencimiento») o **por plan** (días de prueba).
- Una **prueba** sigue siendo prueba hasta el primer pago, aunque venza: si no paga, sigue el mismo camino (gracia → solo lectura → cancelada).
- Un **pago** extiende desde el fin del periodo si todavía no vence (no pierde días pagados) o desde hoy si ya venció (el hueco sin pagar no se cobra). Un negocio cancelado con la baja pedida **por el sistema** se reactiva solo al pagar; una baja pedida **por una persona** nunca se toca.

## 4. Dónde se aplica cada cosa (y por qué ahí)

| Capa | Qué decide | Por qué ahí |
| --- | --- | --- |
| Directorio de hosts (`control-directory.ts`) | Trae el plan con el negocio y calcula su estado en cada consulta; un negocio **cancelado** se muestra como «suspendido por pago» y **ni siquiera se abre su credencial** | Es la única fuente de «qué negocio es este host». Se guarda 20 s en memoria y se invalida al cambiar algo desde el panel (en la misma instancia). |
| `proxy.ts` | Cancelado → página 403; módulo no incluido → página 403 por **ruta** (pantallas y endpoints) | Corta antes de leer cookies ni tocar la base. |
| `db` (resolutor) | En solo lectura, cualquier escritura que no sea abrir/cerrar sesión, contadores de ingreso, cambio de la propia contraseña o auditoría lanza `ReadOnlyAccountError` | Todo el acceso a datos pasa por `db`: ni una pantalla olvidada puede escribir. |
| `requireUserCapability` / `requirePageCapability` | Capacidad de un módulo no comprado → error / «no encontrada» | Una acción puede invocarse desde una pantalla de otro módulo (el punto de venta). |
| Servicios (`createUser`, `createProductTx`, …) | Tope de usuarios y de productos | Es donde se crea el dato, dentro de su transacción. |
| Interfaz | Menú sin lo no incluido, franja de aviso, «3 de 5 usuarios» | Comodidad: **no es seguridad**, todo lo anterior se exige igual en el servidor. |

## 5. Decisiones y hallazgos

- **El estado se calcula, no se guarda.** La columna `status` de la suscripción es solo «lo último que anotó el barrido» (para la auditoría y los listados); el acceso se decide con las fechas y la hora en cada consulta. Un día sin barrido no deja a nadie con más ni menos acceso.
- **Sin plan = sin restricciones** (y los procesos de línea de comandos, como vencer apartados, no se restringen). Es lo que permite adoptar la tienda actual y los negocios anteriores sin sorpresas; la contrapartida es que **un negocio que olvidas ponerle plan no paga ni se limita**: el panel lo muestra como «Sin plan» en la lista de negocios.
- **El corte de escrituras vive en `db`, no en cada acción.** Así cubre también lo que se agregue mañana. Para no romper el ingreso, la lista de lo permitido es pequeña y explícita (`read-only-guard.ts`) y tiene su propia prueba.
- **La prueba de integración encontró un error real**: el directorio pedía la suscripción a la base pero no la entregaba al resto del sistema (el negocio nunca veía su plan). Estaba cubierto por pruebas de unidad con datos ya armados; solo la prueba con la base central de verdad lo mostró. Se corrigió y quedó la prueba.
- **La prueba de unidad del proxy encontró otro**: el corte por módulo buscaba el negocio con el host sin normalizar (con puerto).
- **`isTrial` es una columna**, no un estado: el barrido anota «solo lectura» sobre una prueba vencida y, si se usara el estado para saber si era prueba, se perdería ese dato.
- **Cambiar de plan** cierra la fila vieja (`EXPIRED`) y abre otra con las mismas fechas pagadas; un índice único parcial garantiza una sola suscripción vigente por negocio, también ante dos cambios simultáneos. «En la próxima renovación» programa el cambio y el siguiente pago lo aplica.
- **Los pagos y la auditoría son de solo inserción** en la base (trigger), igual que `AuditLog`.
- **Cajas y sucursales** tienen su lugar en los límites del plan, pero hoy no existe pantalla para crearlas, así que no se aplican (se aplicarán con la Fase 7 de varias sucursales). El formulario del plan lo dice.

## 6. Qué probó cada cosa

- **Unidad** (`tests/unit`): las fronteras de fechas y los meses de fin de mes (`billing`), el cortafuegos de escrituras con un cliente falso (`read-only-guard`: qué se permite y qué no, transacciones, la liberación de la conexión), los límites, los módulos y el mapa de pantallas (`entitlements`), el directorio con suscripciones, el host «vencido» y el proxy (módulos cortados por ruta, sin sesión, modo `single`).
- **Integración con Postgres real**: `billing.test.ts` (planes, pruebas, pagos, cambios de plan, ajustes, el barrido con reloj controlado, la atención del panel y las restricciones de la propia base) y `plan-enforcement.test.ts` (de punta a punta: el host busca el negocio, el directorio trae el plan y las acciones reales —crear usuarios y productos, iniciar sesión— respetan límites, módulos, gracia, solo lectura y cancelación; un pago lo levanta al instante). `provisioning.test.ts` ganó el alta con plan, sin plan, con plan inválido y retomada tras un fallo.
- **Navegador** (`tests/e2e-platform`): el recorrido completo desde el panel — crear el plan (con contraseña equivocada primero), asignarlo con vencimiento pasado, ver la tienda en solo lectura (franja, menú, módulo cortado, no se puede registrar), pagar, volver a trabajar, topar el límite de usuarios y ver todo en la auditoría.

## 7. Verificación

Corridas finales sobre el estado que se entrega (2026-11-01):

| Comprobación | Resultado |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | Limpios |
| `pnpm test` (unitarias + integración contra Postgres real, modo `single`) | **1347 pruebas, 92 archivos** (antes de la etapa: 1243 y 87). La corrida completa dio 1346 verdes y **un fallo**: una prueba de la Etapa 3 («sin cuenta de aprovisionamiento no se crea nada») daba por hecho que el entorno de quien corre las pruebas no define `TENANT_PROVISIONING_URL`, y mi lanzador local sí la define. Se hizo independiente del entorno; ese archivo, **corrido solo después del arreglo, pasa (15/15) en los dos modos**. No repetí la suite entera después de ese único cambio de una prueba. |
| Integración completa en modo estricto `TENANCY_MODE=multi` | **714 pruebas** (antes: 668): 713 verdes y la misma prueba, que ahora pasa sola (15/15). |
| `pnpm test:e2e:platform` (panel, dos negocios por subdominio y el alta desde el panel) | **18 verdes** (antes: 17) — incluye el recorrido de planes y cobros completo. |
| `pnpm test:e2e` (la tienda, modo `single`) | **88 verdes** |
| `E2E_TENANCY=multi pnpm test:e2e` (las mismas 88 con la tienda como negocio #1) | **88 verdes** (la primera vez no arrancó: el preparador de esta prueba vaciaba la tabla de negocios sin las dos tablas nuevas que apuntan a ella; corregido y repetida completa) |
| Ensayo en Docker (imagen de producción, **actualizando una instalación de la Etapa 3** con su volumen) | Se aplican las 2 migraciones nuevas de la base central, el barrido corre al arrancar (`billing_sweep.done`), la flota «se salta» lo que ya está al día y el contenedor queda `healthy`. Con un negocio en solo lectura (`/login` 200, `/api/health` 200) y otro cancelado («Suscripción vencida» 403, `/api/health` 200): el barrido pidió la baja del cancelado, **un pago registrado desde el contenedor la canceló, el negocio volvió a servir (200) y la conciliación quedó sin diferencias**. |

Pruebas nuevas de la etapa: **104 de Vitest** (unidad: fechas y estados 15, cortafuegos de solo lectura 13, límites y módulos 13, directorio/host/proxy 14, códigos de error 3; integración: 32 de planes/pagos/barrido, 10 de punta a punta con la aplicación real, 4 del alta con plan) y **1 de navegador** (el recorrido de planes, cobro, solo lectura y límites).

**Errores propios encontrados y corregidos durante la etapa** (los cazaron las pruebas, no la revisión): (1) el directorio pedía la suscripción a la base pero no se la entregaba al resto del sistema — el negocio nunca veía su plan; solo la prueba contra la base central real lo mostró; (2) el corte por módulo buscaba el negocio con el host sin normalizar; (3) asignar un plan «ya vigente» con un vencimiento pasado violaba la restricción de fechas de la base; (4) el formulario del plan desmarcaba los módulos tras un error y los de cobro borraban el monto tras una contraseña equivocada (React reinicia los formularios al terminar la acción); (5) la preparación de la prueba de la tienda en modo multi no conocía las tablas nuevas.

**Lo que no se pudo ensayar aquí:** un dominio real con certificados de Let's Encrypt y `DEPLOYMENT=production` dentro de Docker (sus reglas están cubiertas por las pruebas de `env.ts`); varias instancias de la app a la vez (la invalidación del directorio entre instancias no existe todavía); y el cobro real de una persona (todo el flujo se probó con datos de prueba).

## 8. Qué queda para las etapas siguientes

- **Respaldos y restauración por negocio, métricas y soporte (Etapa 5)**, incluida la **eliminación definitiva** de las bases archivadas tras la retención (hoy archivar renombra, no destruye).
- **Avisos por correo o mensaje:** hoy los avisos son la franja dentro de la tienda y la lista del panel; el sistema **no envía** correos ni mensajes de cobro.
- **Cobro automático con pasarela** (opcional, fuera de esta etapa): hoy el cobro es manual, como se acordó.
- **Invalidar el directorio entre varias instancias** de la app: con una sola, un cambio desde el panel se nota al instante; con varias, hasta 20 s (la duración de la caché).
- **Límites de cajas y sucursales** cuando existan pantallas para crearlas.
- Endurecimientos que ya estaban anotados: cambio de contraseña obligatorio del propietario recién creado, rol limitado para el negocio #1, limitador de intentos compartido entre instancias, ensayo con dominio real y `DEPLOYMENT=production`.
