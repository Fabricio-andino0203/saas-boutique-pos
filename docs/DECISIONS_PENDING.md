# Decisiones pendientes

> Cada punto trae un **valor por defecto** (el que Claude Code usará si no cambias nada). Revísalos antes de la Fase 0 y edita la columna "Tu decisión". Los marcados 🔴 conviene resolverlos **antes de empezar**; los 🟡, antes de la fase indicada; los 🟢 se pueden dejar por defecto.

## Negocio y fiscal

| # | Pregunta | Prioridad | Valor por defecto asumido | Tu decisión |
|---|---|:-:|---|---|
| 1 | ¿Operas en Honduras con moneda Lempira e ISV 15 %? | 🔴 | Sí. Precios con ISV incluido | |
| 2 | ¿Emites **factura con CAI** en cada venta, solo cuando el cliente la pide, o usas solo ticket interno? | 🔴 | Ticket interno por defecto + factura a solicitud, ambos configurables | |
| 3 | ¿Tienes ya un CAI/rango autorizado por el SAR? ¿Cuántos puntos de emisión (cajas)? | 🔴 | Un rango activo por terminal | |
| 4 | ¿Necesitas **facturación electrónica** ahora o en el futuro cercano? | 🟡 (Fase 3) | No; se deja la interfaz `FiscalDocumentIssuer` lista | |
| 5 | ¿Hay productos exentos de ISV? | 🟡 (Fase 1) | No; todos gravados (campo `taxCategory` existe) | |
| 6 | Validar con tu contador el formato exacto de la factura (campos obligatorios) y la nota de crédito | 🔴 | Se implementa según supuestos de PRD §7 | |

## Operación de la tienda

| # | Pregunta | Prioridad | Valor por defecto | Tu decisión |
|---|---|:-:|---|---|
| 7 | ¿Cuántas cajas/terminales y cuántos cajeros a la vez? | 🟡 | 1–2 terminales, 1–4 usuarios | |
| 8 | ¿Una sola tienda o varias sucursales (hoy o pronto)? | 🟡 | Una; modelo preparado para varias | |
| 9 | Dispositivo del POS: ¿PC de escritorio, laptop, tablet? | 🟡 | Escritorio/laptop principal, tablet soportada | |
| 10 | ¿Tendrás **lector de código de barras**? ¿Qué modelo? | 🟡 | Sí, tipo teclado (USB/Bluetooth) | |
| 11 | ¿**Impresora térmica** de tickets? ¿58 o 80 mm? ¿Con cajón de dinero? | 🟡 | 80 mm vía impresión del navegador | |
| 12 | ¿Impresora de **etiquetas** (rollo) o imprimes en hoja A4 adhesiva? | 🟡 (Fase 2) | Ambas; plantilla configurable | |
| 13 | ¿Tus productos ya tienen código de barras de fábrica o los generarás tú? | 🟡 (Fase 1) | Mixto: se acepta el existente, se genera si falta | |
| 14 | ¿Vendes por **apartado**? ¿Plazo y política si no se salda? | 🟡 (Fase 4) | Sí; 30 días; al expirar el abono pasa a crédito de tienda | |
| 15 | Política de **devoluciones**: ¿cuántos días? ¿efectivo, crédito o solo cambio? ¿qué no se devuelve? | 🟡 (Fase 4) | 8 días; cambio o crédito de tienda (efectivo solo con autorización); ropa interior no | |
| 16 | ¿Cuánto descuento puede dar un cajero sin autorización? | 🟡 (Fase 3) | 10 % | |
| 17 | ¿Aceptas tarjeta (terminal POS externa)? ¿transferencias? ¿otros (billeteras)? | 🟡 (Fase 3) | Efectivo, tarjeta, transferencia, crédito de tienda | |
| 18 | ¿Quieres comisiones de vendedores? | 🟢 | No (fuera del MVP) | |
| 19 | ¿Programa de puntos / lealtad? | 🟢 | No (después del MVP) | |
| 20 | ¿Cuántos productos/variantes aproximadamente tienes hoy? ¿en qué formato están (Excel, papel)? | 🔴 | ~500 prendas, ~2 000 variantes, Excel | |

## Técnicas

| # | Pregunta | Prioridad | Valor por defecto | Tu decisión |
|---|---|:-:|---|---|
| 21 | ¿Dónde se alojará? **A)** VPS/plataforma en la nube **B)** mini PC en la tienda | 🟡 (Fase 6) | A, con respaldo diario externo | Sin definir (2026-10-30): el paquete Docker + Caddy sirve igual para un VPS o un mini PC (`docs/RUNBOOK.md`); falta que la tienda elija y copiar los respaldos fuera del servidor |
| 22 | ¿La conexión a internet de la tienda es estable? ¿Necesitas vender sin internet? | 🟡 | Estable; offline se evalúa en Fase 6 | Aplazado a la Fase 7 (opcional): hoy se necesita conexión para vender |
| 23 | ¿Presupuesto/preferencia de proveedor de nube? | 🟡 | Neon/Supabase + Vercel/Fly o VPS económico | |
| 24 | Dominio y marca (logo, colores) | 🟢 | Acento sobrio, configurable | |
| 25 | Tuteo ("tú") o trato de "usted" en la interfaz | 🟢 | Tuteo | |
| 26 | Idioma de la documentación para el equipo | 🟢 | Español (código en inglés) | |
| 27 | ¿Quién será "Propietario" inicial y qué correo se usa? | 🟡 | Se crea en el onboarding | |
| 28 | Repositorio: ¿GitHub privado? | 🟡 | Sí | |

## Cómo resolver una decisión

1. Edita la columna "Tu decisión".
2. Si cambia algo de producto, actualiza `PRD.md`; si cambia algo técnico, actualiza `ARCHITECTURE.md` (§12 registro de decisiones).
3. Si afecta a Claude Code en cada sesión, refleja el cambio en `CLAUDE.md`.
