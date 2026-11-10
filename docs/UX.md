# Guía de UX y diseño

> Objetivo: que se sienta **obvio**. Un cajero nuevo debe poder vender en su primer intento; el dueño debe poder encontrar cualquier dato en dos clics.

## 1. Principios

1. **Una pantalla, una tarea.** Cada pantalla responde a "¿qué quiero hacer ahora?" y destaca una sola acción primaria.
2. **El POS es teclado + escáner primero, táctil segundo, mouse tercero.** Nada de ir y venir con el mouse en mostrador.
3. **Lenguaje de tienda, no de sistema.** "Apartado", "Cambio", "Cobrar", "Cerrar caja"; nunca "transacción", "entidad", "SKU" sin explicar (en pantalla se muestra "Código").
4. **Errores que ayudan.** Dicen qué pasó y qué hacer: "No hay más de esta prenda en talla M. Quedan 0. ¿Ver otras tallas?".
5. **Deshacer sobre confirmar.** Para acciones reversibles, permitir deshacer; confirmar solo en lo destructivo o irreversible.
6. **Lo importante a la vista, lo avanzado escondido.** Costos, márgenes y ajustes solo para quien tiene permiso; no se muestran deshabilitados, simplemente no aparecen.
7. **Siempre estados:** cargando, vacío (con acción sugerida), error y éxito.
8. **Consistencia.** Mismos componentes, mismos atajos, mismos colores semánticos en todo el sistema.

## 2. Navegación

Barra lateral izquierda, agrupada en **grupos plegables** (por omisión solo el primero y el de la pantalla actual están abiertos; lo que cada persona abre o cierra se recuerda en su navegador) y reducible a **iconos**: con el menú reducido cada grupo es un solo icono (Ventas, Mercadería, Inventario, Gente, Finanzas, Administración) y su lista de pantallas se abre al lado al pasar el mouse o con Enter; «Inicio» queda suelto con su tooltip. La elección de reducir se guarda en una cookie, así el menú vuelve a abrirse como se dejó. En el teléfono es la hoja lateral de siempre con los mismos grupos. Agrupación de referencia (los nombres exactos están en `messages.nav.groups`):

- **Vender:** Punto de venta · Apartados · Devoluciones · Cierres de caja (la caja en sí se opera dentro del punto de venta, §6)
- **Mercadería:** Productos · Inventario · Compras · Etiquetas
- **Gente:** Clientes · Proveedores
- **Negocio:** Ventas (historial) · Reportes · Dashboard
- **Admin** (solo Propietario): Usuarios · Configuración · Auditoría

Barra superior: sucursal/terminal, estado de caja (abierta/cerrada y quién), búsqueda global (`Ctrl+K`), usuario y cambio rápido de cajero.
El menú muestra solo lo que el rol puede usar. El **Cajero** ve un menú reducido de 4–5 elementos.

## 3. Pantalla de venta (la más importante)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ☰  Caja 1 · Abierta (María)               [Ventas en espera 2]  [Cliente]│
├───────────────────────────────────────┬──────────────────────────────────┤
│ 🔍 Escanea o busca… (siempre enfocado)│  TICKET                          │
│───────────────────────────────────────│  ──────────────────────────────  │
│ [Mujer] [Hombre] [Niños] [Accesorios] │  Vestido floral · M · Azul       │
│                                       │    1 × L 650.00        L 650.00  │
│ ┌────────┐ ┌────────┐ ┌────────┐      │  Blusa lino · S · Blanco         │
│ │ foto   │ │ foto   │ │ foto   │      │    2 × L 320.00        L 640.00  │
│ │Vestido │ │ Blusa  │ │ Jeans  │      │      desc. 10%        −L  64.00  │
│ │L 650   │ │L 320   │ │L 780   │      │                                  │
│ └────────┘ └────────┘ └────────┘      │  Subtotal              L 1,290.00│
│  (rejilla de resultados / favoritos)  │  Descuento            −L    64.00│
│                                       │  ISV incluido (15%)    L   159.91│
│                                       │  ┌──────────────────────────────┐│
│                                       │  │  TOTAL        L 1,226.00     ││
│                                       │  └──────────────────────────────┘│
│                                       │  [Descuento F4] [Nota]           │
│                                       │  [        COBRAR  F12        ]   │
└───────────────────────────────────────┴──────────────────────────────────┘
```

**Comportamientos:**
- El campo de búsqueda **siempre tiene foco**; un escaneo agrega la prenda al ticket de inmediato con un sonido breve (confirmación) y un parpadeo suave de la línea.
- Si el código pertenece a una variante exacta → entra directo. Si se busca por nombre y hay varias variantes → aparece un **selector de talla/color** visual (chips de talla con stock; las agotadas atenuadas pero visibles).
- Cantidad: tocar/clic en la línea → `+ / −` grandes o escribir número. Quitar con `Supr`.
- **Total siempre grande y visible.** El botón **Cobrar** es el elemento más prominente.
- Ventas en espera: botón superior; muestran cliente/hora/total para recuperar con un toque.

### Diálogo de cobro
- Muestra el total; botones grandes por método: **Efectivo · Tarjeta · Transferencia · Crédito de tienda**.
- Efectivo: teclado numérico en pantalla + **botones de billetes rápidos** (L 100, 200, 500, "Exacto"); calcula el cambio en grande.
- Pago mixto: al pagar un método parcial, el diálogo queda con el **saldo restante** y permite añadir otro método.
- Al confirmar: pantalla de éxito con **cambio a entregar**, [Imprimir ticket] [Enviar por WhatsApp*] [Nueva venta] (Enter = Nueva venta e imprime según preferencia).
- *WhatsApp: mejora posterior.

### Atajos de teclado (consistentes)
| Atajo | Acción |
|---|---|
| `F1` | Ayuda / lista de atajos |
| `F2` | Enfocar búsqueda |
| `F3` | Cliente |
| `F4` | Descuento |
| `F6` | Poner venta en espera / ver en espera |
| `F8` | Devolución / cambio |
| `F9` | Reimprimir último ticket |
| `F12` | Cobrar |
| `Esc` | Cerrar diálogo / cancelar acción actual |
| `Supr` | Quitar línea seleccionada |
| `Ctrl+K` | Búsqueda global |

**Ninguna acción existe solo por teclado:** cada atajo tiene su botón en pantalla (Cliente, Descuento, En espera, Apartar, Devoluciones, **Reimprimir**, Cobrar, Atajos) y el atajo solo es la forma rápida de pulsarlo. `F2` y `Ctrl+K` llevan al campo de búsqueda, que siempre está a la vista; `Esc` y `Supr` equivalen a cerrar la ventana y a la **X** de cada línea.

## 4. Catálogo: crear productos sin sufrir

El mayor cuello de botella de cualquier boutique es **cargar productos**. Diseñar para eso:

1. **Paso 1 — Datos de la prenda:** nombre, categoría, marca, temporada, precio, costo, foto (arrastrar).
2. **Paso 2 — Tallas y colores:** chips seleccionables para tallas y colores (con "agregar nueva" inline). El sistema genera la **matriz** talla × color.
3. **Paso 3 — Cantidad inicial:** una cuadrícula editable (como hoja de cálculo) con la cantidad por celda; `Tab` para avanzar. Opción "mismo costo/precio para todas" o personalizar por celda.
4. **Vista previa:** cuántas variantes se crearán, SKUs, códigos de barras. Botón [Guardar e imprimir etiquetas].
- Duplicar producto ("copiar como nuevo") para prendas similares.
- Edición masiva: cambiar precio/categoría/temporada a varias prendas seleccionadas.
- Importar CSV con vista previa de errores por fila (línea, columna, problema) y opción de corregir antes de confirmar.

## 5. Inventario

- **Vista principal:** tabla con foto, producto, variantes agregadas, stock total, stock bajo resaltado, valor. Expandir una fila muestra la **matriz de tallas × colores** con cantidades (semáforo: sin stock / bajo / ok).
- **Kardex** accesible desde cualquier variante: línea de tiempo de movimientos con documento origen clicable.
- **Ajuste rápido:** botón en la fila; pide cantidad y **motivo obligatorio** (lista corta + "otro").
- **Conteo físico:** modo escáner: pantalla grande con el último artículo escaneado, contador y progreso; vibración/sonido al escanear; resumen de diferencias antes de aplicar.

## 6. Caja

La caja vive **dentro de Vender** (no tiene entrada propia en el menú; `/caja` lleva a Vender). El botón **Caja** del encabezado del punto de venta abre un panel lateral: arriba el efectivo que debe haber, siempre a la vista, y debajo los **botones de una caja registradora** —*Ingresar efectivo*, *Retirar efectivo*, *Agregar gasto* (solo con Finanzas), *Apartados* y *Realizar corte*— seguidos del detalle del turno y sus movimientos. Cada acción de efectivo abre su formulario dentro del panel con una flecha para volver; todas piden un motivo. El panel se pide al abrirlo y tras cada cambio; los atajos del punto de venta se pausan mientras está abierto. El corte queda montado: volver al menú no borra lo que se estaba contando.

- **Apertura:** si no hay turno abierto, Vender muestra «Abre tu caja» con un solo botón. Si el último cierre dejó efectivo, se ve el **saldo anterior** en grande, con quién lo dejó y cuándo, y **no se puede cambiar**: la caja abre con ese saldo (la diferencia con el cajón se registra después con Ingresar o Retirar efectivo y su motivo). Sin saldo anterior, un único campo: fondo inicial.
- **Vaciar ticket:** con prendas en el ticket, el botón del propio ticket (la papelera) abre un diálogo que pide el **motivo** y deja constancia; sin él no se vacía. Descartar un ticket en espera pasa por lo mismo. No está en el panel de Caja: una venta **ya cobrada** no se cancela, se deshace con una **devolución** o una anulación.
- **Corte:** pasos: *contar billetes y monedas (siempre; el total sale solo) → ver la diferencia → cuánto se retira → comentario y cerrar*. La diferencia se colorea: verde (0), ámbar (pequeña), rojo (grande). El retiro tiene botones «Retirar todo» y «No retirar nada» y una línea que dice cuánto **queda en la caja para mañana**; no deja retirar más de lo contado. Imprimible.
- La caja de otra persona: si la terminal la abrió alguien más, el panel lo explica y no deja operar (solo quien abrió el turno lo cierra).
- Sin turno abierto, Vender muestra el formulario de apertura en lugar del punto de venta.

## 7. Reportes y dashboard

- Dashboard con **5–6 tarjetas** máximo: Ventas de hoy, Tickets, Ticket promedio, Utilidad (si el rol puede), Stock bajo, Caja actual. Debajo: ventas por hora (barras), top 5 productos, alertas.
- Reportes: filtros arriba (rango de fechas con atajos "Hoy / Ayer / Esta semana / Este mes"), tabla + gráfico, [Exportar].
- Gráficos simples y legibles; siempre acompañados de la tabla; sin 3D ni decoraciones.

## 8. Sistema visual

- **Sensación:** limpia, profesional, cálida; que acompañe a una boutique (no un ERP gris).
- **Marca:** **Boutique Ventas · by Andino Software** (kit `boutique_ventas_identidad_completa.svg`). Rosa `#F43F78` (logo, enfoque, acentos, cifras grandes), ciruela `#5B1E3D` (títulos y texto de marca), rosa suave `#FBC3D2` y fondo cálido `#FFF9FB`. Los botones y enlaces usan un rosa algo más profundo (`--primary`, `#D6275F` en claro y `#FF6B96` en oscuro) porque el rosa exacto con texto blanco da 3.6:1 y el mínimo AA es 4.5:1. Semánticos fijos: éxito verde, advertencia ámbar, error rojo (distinto del rosa de marca), info azul.
- **Logo e iconos:** `BrandMark` y `BrandLogo` (`src/components/layout/brand-mark.tsx`) en menú lateral y pantallas de acceso; favicon `src/app/icon.svg`, `favicon.ico` (16/32/48) y `apple-icon.png` (180 px), generados desde el kit con la «B» de Poppins Bold convertida a trazos. Estos tres archivos son públicos (el proxy no los redirige a /login).
- **Tipografía:** Poppins (600/700/800) para logotipo y títulos `h1`–`h3` (`font-heading`) e Inter para la interfaz, con cifras tabulares para dinero; tamaños base de 16 px; en POS 18–24 px para totales.
- **Espaciado y tamaño táctil:** objetivos ≥ 44×44 px en POS; botones primarios grandes.
- **Dinero:** siempre `L 1,234.50`, alineado a la derecha, cifras tabulares, negativos en rojo con signo.
- **Modo claro y oscuro:** dos paletas pensadas por separado en `src/app/globals.css` (`:root` y `.dark`), no una invertida. El botón sol/luna (`ThemeToggle`) está en el encabezado de la app, del panel de plataforma y en las pantallas de acceso; la primera visita sigue la preferencia del sistema y la elección se recuerda por navegador (`localStorage`, clave `theme`). Un script en `<head>` (`theme-script.ts`) pone la clase `dark` antes de pintar para que no parpadee. Las hojas de impresión (tickets, facturas, etiquetas) fuerzan blanco y negro. `tests/unit/theme-contrast.test.ts` exige 4.5:1 en texto y 3:1 en bordes de controles y anillo de enfoque en ambos temas: al cambiar un color de la marca, esa prueba dice si sigue siendo legible.
- **Iconos:** lucide-react, siempre con etiqueta de texto en acciones principales.
- **Botones y carga:** todo botón `type="submit"` muestra solo el indicador mientras su formulario (con `action`) se envía (`PendingSpinner`); fuera de un formulario con `action` se usa `loading={pending}`, que además deshabilita el botón y marca `aria-busy`. No se usa `disabled={pending}` en botones. El estado `hover` pinta con el tono de la marca (`accent`) y al presionar el botón se hunde un poco.
- **Avisos en pantalla (`Notice`):** errores, éxitos, advertencias e información dentro de la pantalla usan `Notice` (`src/components/shared/notice.tsx`): icono + fondo suave + texto normal (no depende solo del color), entra con una animación corta. Los errores se anuncian con `role="alert"` y el resto con `role="status"`. No se escriben `<p role="alert" className="text-destructive">` sueltos.
- **Confirmaciones breves (toast, `sonner`):** `toast.success(messages.toasts.x)` para acciones que terminan sin otro mensaje (refrescar o cambiar de pantalla en silencio). Los errores no van en toast: se quedan junto al campo o formulario con `Notice`. El `Toaster` vive en el layout raíz, aparece arriba al centro, dura 3.5 s y no se imprime.
- **Boleto:** la forma de «boleto» (muescas a los lados y una línea de corte punteada) separa lo que se mira de lo que se hace o se cobra. `TicketCard` (arriba/abajo) la usa para la caja del inicio y el ticket de venta usa las mismas clases `.ticket-top` / `.ticket-bottom` (globals.css): cada mitad recorta sus esquinas, así la línea cae donde terminan los contenidos sin importar su altura. Es el único elemento atrevido; no se usa en otros lugares.
- **Menú lateral:** `SidebarNav` marca la pantalla abierta con fondo suave, barra rosa a la izquierda y `aria-current="page"`; gana la entrada más larga que contenga la ruta (`activeHref`). El usuario se muestra como círculo con iniciales (`UserAvatar`) más nombre y rol en el encabezado.
- **Carga y movimiento:** bloques `Skeleton` con un brillo de marca; ruedita en el menú si una pantalla tarda en abrir (`NavPending`, aparece tras 200 ms); check animado en «venta cobrada» (`SuccessCheck`); el inicio entra una sola vez con `.stagger`. Duraciones de 150–400 ms y todo se apaga con «reducir movimiento» (regla global en `globals.css`).
- **Tokens** de diseño en CSS variables (`--color-primary`, `--radius`, etc.) para poder cambiar la marca en un solo lugar.

### Finanzas (módulo de plan)

- **Menú:** grupo «Finanzas» (Resumen, Movimientos, Caja de finanzas, Costos fijos, Categorías de Finanzas) solo para Propietario y Gerente y solo si el plan incluye el módulo. El cajero no lo ve y las direcciones le muestran «no encontrado».
- **Resumen** (`/finanzas`): la utilidad neta del periodo como cifra grande con su margen, cuatro cifras planas (ventas netas, utilidad bruta, otros ingresos, gastos) y el **estado de resultados** como tabla con las categorías como subtotales. Mismo selector de periodo que los reportes.
- **Movimientos:** gastos e ingresos que no son ventas, con filtros (tipo, categoría, forma de pago, anulados), totales que no cuentan los anulados, «Nuevo gasto» / «Nuevo ingreso» y «Anular» con motivo (el movimiento no se borra). Un gasto que salió de la caja lleva la marca «De la caja» y no se anula desde aquí.
- **Costos fijos:** primero lo que está **por pagar** (con «Vencido» si ya pasó el día) y «Registrar pago» con el monto habitual editable; abajo, la lista de costos fijos. Se muestran los últimos 6 meses y el actual.
- **Caja:** con el módulo, las salidas y entradas de efectivo preguntan «¿Qué fue?» y, si es un gasto o un ingreso, su categoría; sin el módulo el formulario es el de siempre.
- **Caja de finanzas** (`/finanzas/caja`): el saldo del efectivo del negocio fuera del cajón como cifra grande, cuatro cifras planas (retirado en cierres, ingresos en efectivo, gastos en efectivo, retirado de la caja) y dos listas: los **retiros de los cierres de caja** (con enlace a cada cierre) y los **retiros de la caja de finanzas**. «Retirar de la caja» (Propietario y Gerente) abre una ventana con fecha, monto y «¿Para qué es?» (lo que se lleva el dueño o se deposita en el banco; no es un gasto) y muestra el saldo disponible; no deja retirar más de lo que hay. Un retiro se **anula** con motivo (no se borra): queda en la lista tachado con «Anulado» y su motivo, y el saldo lo recupera. Un saldo negativo se pinta en rojo con un aviso «revísalos» y un enlace a esos gastos; no se oculta. El resumen de Finanzas la enseña en una sección corta con enlace.
- **Patrones:** los formularios van en ventanas (`Dialog`), los errores se quedan dentro de la ventana con `Notice`, y lo que termina bien confirma con un toast. Los meses se escriben con mayúscula inicial («Noviembre de 2026»).

## 9. Accesibilidad y responsividad

- WCAG 2.1 AA: contraste, foco visible, navegación por teclado completa, `aria-label` en iconos, mensajes de error asociados a campos.
- Layouts probados en: escritorio 1366×768, tablet 1024×768 (horizontal) y tablet vertical. El POS en móvil es "mejor esfuerzo"; el resto del sistema debe ser usable en móvil para consultar stock.
- Feedback no solo por color (iconos y texto además del color).

## 10. Copy (tono y ejemplos)

Tono: cercano, claro, respetuoso, en tuteo ("tú") o "usted" según preferencia (por defecto tuteo). Frases cortas.

### Pantallas limpias: las reglas

Una pantalla se lee de un vistazo cuando solo dice lo que hace falta. Estas reglas valen para todo texto nuevo y son lo que se revisa en cada cambio de pantalla (las skills `design:ux-copy`, `design:design-critique` y `design:accessibility-review` sirven de lista de comprobación):

1. **Un título y nada que lo repita.** Una pantalla no lleva subtítulo salvo que diga algo que el título no dice (un rango de fechas, quién abrió la caja, una cifra). «Productos» no necesita «Las prendas que vendes».
2. **La ayuda va donde un error cuesta dinero o datos.** Un campo obvio no lleva ayuda. Si la lleva: una línea, de 12 palabras o menos, sin repetir la etiqueta. Un ejemplo corto («Ej.: Recibo de luz de octubre») vale más que una explicación.
3. **Etiquetas de hasta 3 palabras** y un mismo verbo para la misma acción en toda la aplicación (Guardar, Crear, Archivar, Anular, Vaciar ticket, Cobrar). «Cancelar» se reserva para salir de un formulario; no se usa para deshacer ventas.
4. **Estados vacíos: una línea y un botón.** Sin párrafos.
5. **Avisos solo si se puede actuar.** Una frase: qué pasó y qué hacer. Los errores no piden disculpas.
6. **Cada atajo tiene su botón, y la tecla no se repite en él.** Los atajos (F6, F7, F8, F9, F1…) viven en el tooltip y en la ayuda «Atajos»; solo quedan a la vista en Cobrar y Descuento. Ninguna acción existe solo por teclado.
7. **Letra legible:** 14 px (`text-sm`) como mínimo para cualquier ayuda, nota, línea secundaria o error. `text-xs` (12 px) solo para insignias, atajos, códigos y ejes de gráficas. Contraste AA en claro y oscuro.
8. **Los números mandan:** el dinero y las cantidades van grandes y alineados; las palabras que los rodean, las justas.

Medida: `messages.es.ts` pasó de 9,226 a 7,712 palabras; las ayudas y descripciones, de 2,159 a 1,108; y las frases de más de 12 palabras, de 162 a 47. `tests/unit/copy-budget.test.ts` fija un tope a esas tres cifras: si una función nueva necesita más texto, se sube el tope en el mismo cambio y se explica por qué; si no, se recorta otro texto.

| Situación | Texto |
|---|---|
| Caja cerrada | "Abre tu caja" |
| Sin stock | "Sin existencia de esta talla." |
| Venta exitosa | "¡Venta registrada! Cambio a entregar: L 150.00" |
| Descuento sobre el límite | "Pasa tu límite: al cobrar pedirá la aprobación de un gerente." |
| Vaciar ticket | Un campo: «Motivo». Botón «Vaciar ticket». |
| Anular venta | "Vas a anular esta venta. Las prendas volverán al inventario y el pago se revertirá. Escribe el motivo." |
| Lista vacía (productos) | "Aún no tienes productos." y el botón «Crear producto» |
| Cierre con diferencia | "Hay una diferencia de L 20.00 (faltante). Agrega un comentario para continuar." |
| CAI por vencer | "Tu rango de facturas vence en 12 días. Solicita uno nuevo al SAR." |

## 11. Onboarding

- Asistente inicial de 5 pasos: datos del negocio → impuestos y facturación (CAI) → crear usuarios → métodos de pago → cargar catálogo (importar o crear el primero).
- Datos de demostración opcionales (botón "Cargar datos de ejemplo") para explorar sin riesgo; separados y borrables.
- Ayuda contextual: iconos "?" con explicaciones de una línea; pantalla de atajos (`F1`).
- Primera venta guiada con tooltips (se pueden descartar).
