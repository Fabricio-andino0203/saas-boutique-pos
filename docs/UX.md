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

Barra lateral izquierda, colapsable (iconos + texto), agrupada:

- **Vender:** Punto de venta · Caja · Apartados · Devoluciones
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

- **Apertura:** un solo campo (fondo inicial) y [Abrir caja].
- **Cierre:** asistente de 3 pasos: *resumen esperado → contar efectivo (opcional por denominaciones) → diferencia y comentario*. La diferencia se colorea: verde (0), ámbar (pequeña), rojo (grande). Imprimible.
- Estado de caja siempre visible en la barra superior; si está cerrada, el POS muestra una pantalla amable: "Abre tu caja para empezar a vender".

## 7. Reportes y dashboard

- Dashboard con **5–6 tarjetas** máximo: Ventas de hoy, Tickets, Ticket promedio, Utilidad (si el rol puede), Stock bajo, Caja actual. Debajo: ventas por hora (barras), top 5 productos, alertas.
- Reportes: filtros arriba (rango de fechas con atajos "Hoy / Ayer / Esta semana / Este mes"), tabla + gráfico, [Exportar].
- Gráficos simples y legibles; siempre acompañados de la tabla; sin 3D ni decoraciones.

## 8. Sistema visual

- **Sensación:** limpia, profesional, cálida; que acompañe a una boutique (no un ERP gris).
- **Color:** neutros cálidos de base + **un color de marca** configurable (por defecto un acento sobrio, p. ej. verde salvia o ciruela). Semánticos fijos: éxito verde, advertencia ámbar, error rojo, info azul.
- **Tipografía:** sans-serif legible (Inter o similar) con cifras tabulares para dinero; tamaños base de 16 px; en POS 18–24 px para totales.
- **Espaciado y tamaño táctil:** objetivos ≥ 44×44 px en POS; botones primarios grandes.
- **Dinero:** siempre `L 1,234.50`, alineado a la derecha, cifras tabulares, negativos en rojo con signo.
- **Modo oscuro:** opcional (Fase 6); el POS debe verse bien con luz de tienda (alto contraste).
- **Iconos:** lucide-react, siempre con etiqueta de texto en acciones principales.
- **Tokens** de diseño en CSS variables (`--color-primary`, `--radius`, etc.) para poder cambiar la marca en un solo lugar.

## 9. Accesibilidad y responsividad

- WCAG 2.1 AA: contraste, foco visible, navegación por teclado completa, `aria-label` en iconos, mensajes de error asociados a campos.
- Layouts probados en: escritorio 1366×768, tablet 1024×768 (horizontal) y tablet vertical. El POS en móvil es "mejor esfuerzo"; el resto del sistema debe ser usable en móvil para consultar stock.
- Feedback no solo por color (iconos y texto además del color).

## 10. Copy (tono y ejemplos)

Tono: cercano, claro, respetuoso, en tuteo ("tú") o "usted" según preferencia (por defecto tuteo). Frases cortas.

| Situación | Texto |
|---|---|
| Caja cerrada | "Abre tu caja para empezar a vender." |
| Sin stock | "No quedan prendas de esta talla. ¿Quieres ver otras tallas o colores?" |
| Venta exitosa | "¡Venta registrada! Cambio a entregar: L 150.00" |
| Descuento sobre el límite | "Este descuento necesita la aprobación de un gerente. Pídele que ingrese su PIN." |
| Anular venta | "Vas a anular esta venta. Las prendas volverán al inventario y el pago se revertirá. Escribe el motivo." |
| Lista vacía (productos) | "Aún no tienes productos. Crea el primero o importa tu catálogo desde Excel." |
| Cierre con diferencia | "Hay una diferencia de L 20.00 (faltante). Agrega un comentario para continuar." |
| CAI por vencer | "Tu rango de facturas vence en 12 días. Solicita uno nuevo al SAR." |

## 11. Onboarding

- Asistente inicial de 5 pasos: datos del negocio → impuestos y facturación (CAI) → crear usuarios → métodos de pago → cargar catálogo (importar o crear el primero).
- Datos de demostración opcionales (botón "Cargar datos de ejemplo") para explorar sin riesgo; separados y borrables.
- Ayuda contextual: iconos "?" con explicaciones de una línea; pantalla de atajos (`F1`).
- Primera venta guiada con tooltips (se pueden descartar).
