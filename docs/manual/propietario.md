# Manual del propietario

Eres el único que cambia la configuración y las personas. Todo lo que hace el gerente (ver [gerente.md](gerente.md)) también lo puedes hacer tú. Lo técnico (servidor, respaldos) está en [`docs/RUNBOOK.md`](../RUNBOOK.md); aquí, lo que haces desde el sistema.

## 1. Primer día

1. Quien instala el sistema crea tu usuario con `pnpm admin:create-owner` (te pide nombre, usuario, contraseña y un PIN opcional). **No hay usuarios de demostración** en una instalación real.
2. Entra y sigue la **Bienvenida** (cinco pasos): datos del negocio (nombre, RTN, teléfono, dirección; salen en el ticket y en la factura), impuestos y formas de pago, reglas de venta, y tu mercadería.
3. **Reglas de venta** que puedes ajustar: descuento máximo del cajero (10 % por defecto), días para devolver (8), días de un apartado (30), abono mínimo para apartar (20 %) y si se permite vender sin existencia (apagado de fábrica).
4. Carga tu mercadería: producto por producto (**Productos → Nuevo**) o **Importar desde Excel** con la plantilla que descargas ahí mismo. Si quieres probar primero, **Cargar datos de ejemplo** crea 8 prendas de muestra (se pueden dejar en cero y archivar).

## 2. Personas

En **Usuarios** creas a tu gente y eliges su rol:

| Rol | Puede |
| --- | --- |
| Propietario | Todo, incluida la configuración y los usuarios |
| Gerente | La operación del día: autorizar, aprobar cierres, reportes con utilidad, inventario |
| Cajero | Vender, cobrar, devoluciones, apartados, su caja y sus propios reportes (sin costos) |
| Almacén | Productos, recepciones, ajustes y conteos; no ve ventas |

- **Contraseña y PIN:** cada persona tiene la suya. Si alguien la olvida, la restableces tú (o un gerente): eso también la desbloquea y cierra sus sesiones abiertas.
- **Quitar a alguien:** **desactívalo**, no se borra (su historial queda). Siempre debe quedar al menos un propietario activo.
- Tu contraseña la cambias en **Mi cuenta**.

## 3. Facturas con CAI

Si emites factura con CAI, en **Configuración** registras el rango autorizado por el SAR (prefijo, números, fecha límite). El sistema numera sin saltos, avisa cuando quedan pocos números o falta poco para que venza y deja de emitir al agotarse o vencer. **Pendiente:** que tu contador valide el formato exacto de la factura y de la nota de crédito antes de usarlas con clientes.

## 4. Cómo va el negocio

- **Inicio:** ventas de hoy, tickets, ticket promedio, utilidad, stock bajo, caja actual, ventas por hora y lo más vendido.
- **Reportes:** periodos y cortes por cajero, categoría, marca, método de pago y hora; más y menos vendidos; tallas y colores; cierres de caja; valoración del inventario (a costo y a precio de venta) y prendas sin movimiento. Todos se exportan a **Excel** o **CSV**; la valoración también tiene una hoja para imprimir.
- **Auditoría:** quién hizo qué y cuándo: anulaciones, descuentos sobre el límite, ajustes de inventario, cambios de precio y de costo, cierres, cambios de usuarios. **No se puede borrar.**

## 5. Cuidar los datos

- Cada noche el sistema hace un **respaldo cifrado**; pídele a quien administra el servidor que lo copie fuera y que **ensaye la restauración cada tres meses**.
- **Guarda la clave de los respaldos** fuera del servidor (por ejemplo, en un gestor de contraseñas): sin ella los respaldos no se abren y no hay forma de recuperarla.
- Una venta, una devolución o un cierre **no se editan ni se borran**; se corrigen con otra operación. Si algo no cuadra, avisa a quien administra el sistema sin tocar nada.
