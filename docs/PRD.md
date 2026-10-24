# PRD — Sistema de Inventario y Punto de Venta para Boutique de Ropa

## 1. Visión

Un sistema web que permita a una boutique de ropa **vender rápido, saber exactamente qué tiene en inventario y cuadrar la caja sin dolor**. Debe poder usarlo una persona nueva en su primer día con una explicación de 10 minutos.

### Objetivos

1. Cobrar una venta típica (1–3 prendas, un método de pago) en **menos de 30 segundos**.
2. El inventario siempre refleja la realidad: cada entrada y salida de prenda queda registrada y es trazable.
3. El cierre de caja diario cuadra y se puede explicar cada diferencia.
4. El dueño ve, sin pedir nada a nadie, **qué se vende, qué no se mueve y cuánto se ganó**.
5. Manejar bien lo propio de la ropa: **tallas, colores, temporadas, cambios y devoluciones**.

### No-objetivos (por ahora)

Contabilidad completa, nómina, e-commerce público, integración con marketplaces, app móvil nativa.

## 2. Usuarios y roles

| Rol | Quién es | Qué necesita |
|---|---|---|
| **Propietario** | Dueño/a | Todo, incluidos costos, márgenes, configuración y usuarios |
| **Gerente** | Encargado/a de tienda | Operar todo el día a día, autorizar descuentos/anulaciones, ver reportes; no cambia configuración crítica |
| **Cajero** | Vendedor/a | Vender, cobrar, consultar stock, abrir/cerrar su caja; **no ve costos** |
| **Almacén** | Quien recibe y ordena mercadería | Recibir compras, etiquetar, conteos, ajustes (con motivo) |

### Matriz de permisos

| Acción | Propietario | Gerente | Cajero | Almacén |
|---|:-:|:-:|:-:|:-:|
| Vender / cobrar | ✓ | ✓ | ✓ | – |
| Aplicar descuento hasta el límite del cajero | ✓ | ✓ | ✓ | – |
| Descuento sobre el límite | ✓ | ✓ | PIN de gerente | – |
| Anular venta | ✓ | ✓ | PIN de gerente | – |
| Devoluciones / cambios | ✓ | ✓ | ✓ (con reglas) | – |
| Abrir / cerrar caja propia | ✓ | ✓ | ✓ | – |
| Ver cierres de otros cajeros | ✓ | ✓ | – | – |
| Crear / editar productos | ✓ | ✓ | – | ✓ |
| Ver costos y márgenes | ✓ | ✓ | – | – |
| Cambiar precios | ✓ | ✓ | – | – |
| Recibir compras | ✓ | ✓ | – | ✓ |
| Ajustes de inventario | ✓ | ✓ | – | ✓ (con motivo) |
| Reportes financieros | ✓ | ✓ | – | – |
| Usuarios y configuración | ✓ | – | – | – |

> Los permisos se definen como una lista de "capacidades" en `src/lib/permissions.ts` y los roles son conjuntos de capacidades. Así se pueden ajustar sin tocar la lógica.

## 3. Alcance

### MVP (Fases 0–5)

Autenticación y roles · catálogo con variantes · inventario con kardex · compras/recepción · conteo físico · POS · caja (apertura/arqueo/cierre) · pagos mixtos · devoluciones y cambios · apartados · crédito de tienda · clientes · reportes básicos · etiquetas con código de barras · recibos imprimibles.

### Después del MVP (Fase 6 y más allá)

Multi-sucursal con transferencias · modo sin conexión (PWA) · programa de lealtad/puntos · tarjetas de regalo · promociones automáticas (2x1, por temporada) · facturación electrónica (si aplica) · integración con WhatsApp para recibos · e-commerce.

### Fuera de alcance explícito

Contabilidad, planillas, CRM de marketing, integración bancaria. **Claude Code no debe construir nada de esto sin que se cambie este documento.**

## 4. Requisitos funcionales

### 4.1 Acceso y seguridad (AUTH)

- **RF-AUTH-1** Inicio de sesión con usuario y contraseña.
- **RF-AUTH-2** Cambio rápido de cajero con **PIN de 4–6 dígitos** en el POS (sin cerrar sesión completa).
- **RF-AUTH-3** Bloqueo por intentos fallidos y cierre de sesión por inactividad (configurable).
- **RF-AUTH-4** Gestión de usuarios (crear, desactivar, asignar rol, resetear contraseña/PIN).
- **RF-AUTH-5** Bitácora de auditoría consultable por filtros (usuario, acción, fecha, entidad).

### 4.2 Catálogo (CAT)

- **RF-CAT-1** Producto = prenda "madre" (nombre, marca, categoría, descripción, temporada, proveedor habitual, foto opcional).
- **RF-CAT-2** Cada producto tiene **variantes** por talla y color; cada variante tiene su **SKU único**, **código de barras** y puede tener precio/costo propio (si no, hereda del producto).
- **RF-CAT-3** **Generador de variantes:** el usuario marca tallas (S, M, L…) y colores y el sistema genera la matriz talla × color con SKU y barras automáticos, y pide la cantidad inicial por celda.
- **RF-CAT-4** Categorías jerárquicas (p. ej. Mujer › Vestidos), marcas, temporadas/colecciones (editables por el usuario).
- **RF-CAT-5** Tallas y colores son catálogos administrables (con orden de presentación: XS, S, M, L, XL…).
- **RF-CAT-6** Búsqueda instantánea por nombre, SKU, código de barras, marca o categoría; tolerante a mayúsculas, tildes y errores leves.
- **RF-CAT-7** Importar productos desde CSV/Excel con plantilla descargable y vista previa de errores antes de confirmar.
- **RF-CAT-8** Archivar productos/variantes (no borrar si tienen historial).
- **RF-CAT-9** Historial de cambios de precio y costo.
- **RF-CAT-10** Generación e impresión de **etiquetas** (código de barras + precio + talla + color) en hoja o rollo.

### 4.3 Inventario (INV)

- **RF-INV-1** Existencias por variante y por ubicación (sucursal/bodega); hoy hay una ubicación, el modelo soporta varias.
- **RF-INV-2** **Kardex**: cada movimiento (compra, venta, devolución, ajuste, conteo, transferencia, apartado) con fecha, usuario, cantidad, costo y referencia al documento origen.
- **RF-INV-3** **Compras / recepción de mercadería:** orden de compra opcional → recepción (total o parcial) → entrada a inventario con costo; actualiza costo promedio.
- **RF-INV-4** **Ajustes manuales** con motivo obligatorio (merma, robo, daño, error de conteo, regalo) y registro en auditoría.
- **RF-INV-5** **Conteo físico (toma de inventario):** crear sesión de conteo, escanear/contar, ver diferencias contra el sistema, aprobar y generar los ajustes automáticamente.
- **RF-INV-6** Stock mínimo por variante o producto y **alertas de reposición**.
- **RF-INV-7** Stock reservado por **apartados** (no disponible para la venta pero aún en tienda).
- **RF-INV-8** Reporte de "inventario muerto": prendas sin ventas en N días.
- **RF-INV-9** Valoración de inventario (a costo y a precio de venta).

### 4.4 Caja (CASH)

- **RF-CASH-1** **Apertura de caja** con monto inicial (fondo).
- **RF-CASH-2** Movimientos de efectivo manuales: entradas (ingreso) y salidas (gasto, retiro) con motivo.
- **RF-CASH-3** **Cierre de caja con arqueo:** el cajero cuenta el efectivo (por denominaciones, opcional), el sistema compara contra lo esperado y muestra la diferencia; el gerente aprueba.
- **RF-CASH-4** Resumen del turno: ventas por método de pago, devoluciones, entradas/salidas, esperado vs contado.
- **RF-CASH-5** No se puede vender sin una caja abierta.
- **RF-CASH-6** Un cajero tiene como máximo una caja abierta a la vez; cada caja pertenece a un "terminal".

### 4.5 Punto de venta (POS)

- **RF-POS-1** Pantalla de venta optimizada para **escáner de código de barras** y para **táctil** (tablet).
- **RF-POS-2** Agregar productos por escaneo, búsqueda o navegación por categorías; si un producto tiene varias variantes se elige talla/color con un selector visual.
- **RF-POS-3** Carrito editable: cantidad, quitar, descuento por línea (monto o %), nota.
- **RF-POS-4** Descuento global a la venta; respeta el límite por rol (ver matriz).
- **RF-POS-5** Impuestos calculados según configuración (precios con ISV incluido, ver §7).
- **RF-POS-6** **Pagos mixtos:** una venta puede pagarse con varios métodos (efectivo + tarjeta + transferencia + crédito de tienda); calcula cambio.
- **RF-POS-7** Asociar cliente a la venta (opcional; obligatorio para apartados y crédito).
- **RF-POS-8** **Ventas en espera** (suspender y recuperar), varias a la vez.
- **RF-POS-9** Recibo/ticket imprimible (térmico 80 mm y A4) y reimprimible; envío por WhatsApp/correo como mejora posterior.
- **RF-POS-10** Atajos de teclado para todas las acciones frecuentes (ver `UX.md`).
- **RF-POS-11** Validación en vivo de existencias: avisar si se intenta vender algo sin stock.
- **RF-POS-12** Idempotencia: pulsar "Cobrar" dos veces o reintentar tras una falla de red no duplica la venta.

### 4.6 Devoluciones y cambios (RET)

- **RF-RET-1** Buscar la venta original por número de ticket, escaneando el ticket o por cliente.
- **RF-RET-2** Devolución total o parcial por línea, con motivo (talla incorrecta, defecto, no le gustó…) y estado de la prenda (vuelve a inventario vendible / merma).
- **RF-RET-3** **Cambio:** devolver prenda(s) y llevarse otra(s) en la misma operación; se cobra o devuelve la diferencia.
- **RF-RET-4** Reembolso en el mismo método de pago, o **crédito de tienda**.
- **RF-RET-5** Política configurable: días máximos para devolver, qué categorías no admiten devolución (p. ej. ropa interior).
- **RF-RET-6** Una devolución siempre referencia la venta original y no puede devolver más de lo vendido.

### 4.7 Apartados (LAY)

- **RF-LAY-1** Crear apartado: cliente + prendas + abono inicial; la mercadería queda **reservada**.
- **RF-LAY-2** Abonos sucesivos con recibo por cada uno; saldo visible.
- **RF-LAY-3** Al saldar, se convierte en venta y las prendas salen del inventario.
- **RF-LAY-4** Vencimiento configurable; al vencer, el apartado se cancela, la prenda vuelve a disponible y el abono se maneja según la política (crédito de tienda o retención parcial).

### 4.8 Clientes (CUS)

- **RF-CUS-1** Ficha de cliente: nombre, teléfono, correo opcional, RTN/ID opcional, notas, tallas favoritas (opcional).
- **RF-CUS-2** Historial de compras, apartados y crédito de tienda.
- **RF-CUS-3** Búsqueda por teléfono o nombre en el POS (creación rápida en 3 campos).
- **RF-CUS-4** Saldo de **crédito de tienda** con movimientos auditables.

### 4.9 Proveedores y compras (SUP)

- **RF-SUP-1** Catálogo de proveedores (contacto, RTN, condiciones).
- **RF-SUP-2** Órdenes de compra, recepciones y costo por recepción.
- **RF-SUP-3** Historial de compras por proveedor.

### 4.10 Reportes y dashboard (REP)

- **RF-REP-1** Dashboard del día: ventas, # tickets, ticket promedio, productos más vendidos, stock bajo, caja actual.
- **RF-REP-2** Ventas por periodo, por cajero, por categoría, por marca, por método de pago.
- **RF-REP-3** Utilidad bruta y margen (solo Propietario/Gerente).
- **RF-REP-4** Productos más y menos vendidos; **rotación** por prenda.
- **RF-REP-5** Matriz de ventas por talla/color (para decidir recompras).
- **RF-REP-6** Cierre de caja histórico y diferencias.
- **RF-REP-7** Valoración de inventario.
- **RF-REP-8** Exportar a CSV/Excel y a PDF los reportes principales.

### 4.11 Configuración (CFG)

- **RF-CFG-1** Datos del negocio (nombre, RTN, dirección, teléfono, logo) que salen en el recibo.
- **RF-CFG-2** Impuestos (tasa de ISV, precios con impuesto incluido sí/no).
- **RF-CFG-3** Numeración de documentos y **rango/CAI** de facturación con fecha límite (ver §7).
- **RF-CFG-4** Métodos de pago activos.
- **RF-CFG-5** Límite de descuento por rol, política de devoluciones, vencimiento de apartados.
- **RF-CFG-6** Formato de ticket y de etiqueta.
- **RF-CFG-7** Permitir o no stock negativo.

## 5. Flujos clave (resumen)

**Venta:** abrir caja → escanear prendas → (opcional: cliente, descuento) → Cobrar → elegir método(s) → confirmar → se descuenta stock, se registra pago, se imprime ticket → siguiente cliente.

**Recepción de mercadería:** crear compra con proveedor → registrar lo recibido (escaneo o manual) → confirmar → entra al kardex con costo → imprimir etiquetas de lo recibido.

**Cambio de talla:** buscar venta → marcar prenda devuelta (motivo "talla") → escanear la nueva → el sistema calcula diferencia → cobrar/reembolsar → una sola operación con un solo comprobante.

**Cierre de caja:** Cerrar caja → contar efectivo → ver diferencia → comentar → gerente aprueba → resumen imprimible.

**Conteo físico:** crear conteo → escanear prendas por zona → ver diferencias → gerente revisa → aprobar → se generan ajustes.

## 6. Requisitos no funcionales

- **Rendimiento:** búsqueda en POS < 200 ms con 20 000 variantes; agregar al carrito < 100 ms; cobrar < 1 s.
- **Disponibilidad:** el POS debe ser usable durante todo el horario de la tienda; respaldos automáticos diarios con prueba de restauración documentada.
- **Integridad:** operaciones de dinero/stock transaccionales y atómicas; ninguna venta puede quedar a medias.
- **Seguridad:** contraseñas con hash (argon2/bcrypt), sesiones seguras, permisos en servidor, protección CSRF, límites de intentos, datos de tarjeta **nunca** almacenados (el cobro con tarjeta es por terminal externa; el sistema solo registra monto y referencia).
- **Usabilidad:** textos en español claro, sin jerga técnica; botones grandes en el POS; funciona en tablet y escritorio; contraste y tamaños accesibles (WCAG AA).
- **Compatibilidad:** Chrome/Edge actuales; resoluciones desde 1024×768.
- **Mantenibilidad:** cobertura de pruebas alta en dinero/stock; migraciones versionadas; documentación viva.
- **Trazabilidad:** auditoría de acciones sensibles; nada se pierde.

## 7. Supuestos de contexto (Honduras) — validar con tu contador

> Estos supuestos están en `DECISIONS_PENDING.md` para confirmarlos. **No son asesoría fiscal.**

- Moneda **Lempira (HNL)**. Precios al público **con ISV incluido** (ISV general 15 %).
- La facturación formal se maneja con **CAI** (Código de Autorización de Impresión) emitido por el SAR, con **rango autorizado** y **fecha límite de emisión**. El sistema debe poder: configurar CAI/rango/fecha límite, numerar correlativamente, **advertir** cuando el rango se agote o la fecha esté por vencer, y **bloquear** la emisión de facturas fuera de rango o vencidas.
- Datos que debe poder mostrar la factura: RTN del emisor, CAI, rango autorizado, fecha límite, RTN/nombre del cliente (cuando se pida factura a nombre), desglose de ISV.
- Podría existir obligación de **facturación electrónica** en el futuro o según el tipo de contribuyente; el diseño debe aislar la emisión de documentos fiscales detrás de una interfaz (`FiscalDocumentIssuer`) para poder cambiar el mecanismo sin tocar el POS.
- Se distingue **ticket interno** (comprobante no fiscal) de **factura** (documento fiscal); la boutique puede usar solo factura, o ticket + factura a solicitud. Es configurable.

## 8. Métricas de éxito

- Un cajero nuevo completa una venta sin ayuda en su primer intento.
- Tiempo medio de cobro < 30 s.
- Diferencia de caja promedio < 0.5 % de las ventas en efectivo.
- Exactitud de inventario ≥ 97 % en el primer conteo físico tras 30 días de uso.
- 0 ventas duplicadas, 0 saltos en la numeración.

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Carga inicial del catálogo es tediosa y se abandona | Importador CSV con plantilla + generador de variantes + seeds de ejemplo |
| Cajeros escanean mal / productos sin etiqueta | Búsqueda rápida por nombre + etiquetado desde el propio sistema |
| Internet inestable en la tienda | Fase 6: modo offline PWA; mientras tanto despliegue local/VPS cercano y respaldo |
| Requisitos fiscales cambian | Interfaz `FiscalDocumentIssuer` aislada y configuración de CAI editable |
| Diferencias de inventario | Kardex inmutable + conteos cíclicos + auditoría |
