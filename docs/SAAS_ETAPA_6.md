# SaaS multi-negocio — Etapa 6: capacidad, conexiones y endurecimiento

> Rama `saas/etapa-0` (la Etapa 6 se construye encima). Propuesta aprobada: [`SAAS_PROPUESTA.md`](SAAS_PROPUESTA.md). Informes anteriores: [`SAAS_ETAPA_0.md`](SAAS_ETAPA_0.md) … [`SAAS_ETAPA_5.md`](SAAS_ETAPA_5.md). Operación: [`RUNBOOK.md`](RUNBOOK.md) §17.
>
> **Criterio de la etapa:** «uso simultáneo de cientos de negocios sin fugas ni errores de conexión; informe de capacidad» — **cumplido con la configuración que se documenta** (secciones 3 y 6). Con la configuración de antes **no** se cumplía: se agotaban las conexiones de Postgres y le fallaba a todo el mundo. Eso se encontró, se midió y se arregló en esta etapa.
>
> **Escala que se va a usar (decisión del 2026-11-01): 20 a 50 negocios.** Las cifras que importan para decidir son las de la sección 3.0. La prueba de estrés con **200 negocios** (secciones 3.1 a 3.8) se hizo antes y se conserva como margen de seguridad y para saber dónde está el techo.

## Veredicto

1. **Con 20 y con 50 negocios la instalación de fábrica va sobrada**: con 50 negocios y cerca de 100 cajas trabajando a la vez, escanear una prenda tarda 23 ms (mediana) y una venta 101 ms; las páginas completas, 60 a 160 ms. Sin ningún ajuste atiende bien hasta ~30 negocios trabajando a la vez; para 50, basta con subir dos números (RUNBOOK §17). Y **200 negocios caben en una instalación** (una base de datos Postgres y una o dos instancias de la aplicación) sin mezclar datos, sin perder una sola venta y con los libros cuadrados en cada uno. En todas las corridas con 200 negocios (más de cien mil operaciones y más de quince mil ventas), la verificación negocio por negocio dio **cero mezclas** y **cero diferencias** de inventario o de libros.
2. **Lo que limita no es la CPU sino las conexiones a Postgres.** Cada negocio atendido en los últimos segundos mantiene 1 o 2 conexiones abiertas; Postgres admite 100 de fábrica. Con la configuración anterior, 200 negocios a la vez agotaban el servidor (pico de 96 de 97 conexiones, 533 errores y 21 cobros que quedaron sin saberse si entraron). Ahora la aplicación **respeta un presupuesto de conexiones** y espera en vez de tumbar a todos; cuántos negocios caben abiertos se decide con dos variables (RUNBOOK §17).
3. **PgBouncer se evaluó y no se recomienda por omisión**: con una base y un rol por negocio no pone un tope global y costó ~50 % del ritmo.
4. **Una instancia de la aplicación es de un solo hilo** (~1 núcleo, ~25 páginas completas por segundo en este equipo). Para 200 negocios con mucho movimiento conviene **dos instancias** (se probaron: sin mezclas, sin errores).
5. **Revisión de seguridad:** 4 hallazgos reales corregidos (agotamiento de conexiones; la tienda #1 atendía con la cuenta principal del servidor; contraseñas temporales que valían para siempre; archivos `.xlsx` «bomba» que podían colgar a todos los negocios) y una regla automática nueva que comprueba que **cada una de las 100 acciones del servidor** revisa quién la pide.
6. **Lo que no se pudo ensayar aquí** (dominio real con certificado, Postgres administrado, un segundo servidor de bases de datos) está en la sección 7, sin maquillar.

## 1. Qué se entregó

| Pieza | Dónde | Para qué |
| --- | --- | --- |
| **Presupuesto de conexiones** | `src/lib/tenancy/tenant-clients.ts`, `TENANT_POOL_MAX_CONNECTIONS` / `_SIZE` / `_MAX_ACTIVE` | La aplicación nunca abre más conexiones hacia los negocios que su presupuesto (60 de fábrica). Si un negocio nuevo necesita lugar y todos están ocupados, **espera** (milisegundos) en vez de abrir de más; pasados 10 s falla con un error reintentable y lo anota (`tenant.pool_busy`). |
| Aviso al arrancar | `src/lib/tenancy/pool-check.ts` | Compara el presupuesto con `max_connections` del servidor y avisa en el registro si no cabe (`pool.budget_exceeds_server`, con el valor a poner). |
| Tarjeta en el Resumen | panel → Resumen → «Negocios abiertos ahora» | Cuántos negocios tiene abiertos la instancia, de cuántos le caben, y cuántas veces hubo que esperar lugar. |
| **Pruebas de capacidad** | `scripts/capacity/` (`pnpm capacity:provision / run / http`) | Dan de alta N negocios con datos de tienda y los cargan: motor real dentro del proceso o páginas por HTTP, con **verificación al final de que nada se mezcló y de que los libros cuadran**. Solo corren en un servidor desechable (exigen `CAPACITY_CONFIRM=<base central>`). |
| **Cambio obligatorio de la contraseña temporal** | `User.mustChangePassword`, `requireSession`, `/cambiar-contrasena` | La contraseña que otra persona le pone a una cuenta (el alta del propietario, el soporte, un gerente que restablece) es temporal: **ninguna pantalla ni acción funciona hasta que se elija una propia**. Lo aplica el servidor. |
| **Rol limitado para la tienda #1** | `pnpm tenants:limit-store`, `src/modules/platform/store-role.ts` | La tienda adoptada atendía con la cuenta principal del servidor; ahora atiende con un rol `t_<id>` que solo lee y escribe sus datos. Una alerta lo recuerda mientras no se haga. |
| **Defensa contra archivos «bomba»** | `src/modules/products/import/zip-guard.ts` | La importación mira lo que el `.xlsx` declara antes de abrirlo (30 MB descomprimidos, 300 archivos, 1000 filas, 60 columnas). |
| **Regla automática** | `tests/unit/architecture.test.ts` | Cada acción del servidor revisa quién la pide; ninguna ruta lee la sesión sin pasar por el control de contraseña temporal. |
| Respaldo en paralelo | `docker/backup/backup.sh`, `BACKUP_PARALLEL` | Con cientos de negocios, 4 respaldos a la vez acortan la ventana de 8,5 a 3,4 minutos. |
| Varias instancias | `Caddyfile.multi` (`dynamic a`, `least_conn`, salud) | `dc up -d --scale app=2`: Caddy reparte entre las instancias que respondan. |
| PgBouncer (opcional) | `docker/pgbouncer`, perfil `pgbouncer`, `pnpm pgbouncer:setup` | Evaluado; apagado por omisión (sección 3.6). |
| Migración | `20261104000000_user_temporary_credentials` | Una columna con valor de fábrica en cada negocio; compatible con la versión anterior de la aplicación. |

Lo que **no** cambia: ninguna regla de ventas, inventario, caja ni reportes. Con `TENANCY_MODE=single` el sistema es el de antes salvo dos cosas que se notan: restablecer la contraseña de otra persona la deja temporal (la persona elige una propia al entrar) y un `.xlsx` desmesurado se rechaza.

## 2. Cómo se midió

**Equipo:** un portátil con Windows 11, **4 núcleos**, Docker Desktop (VM de 8 GB). La aplicación, Postgres (en Docker, versión 16), el generador de carga y el cronómetro comparten esos 4 núcleos: las cifras son un **piso** (un servidor real con núcleos propios para cada pieza rinde más) y sirven sobre todo para **comparar configuraciones entre sí**.

**Datos:** 200 negocios dados de alta con el motor real (receta de 7 pasos), cada uno con 40 prendas, un mes de historia de ventas, una prenda de carga con inventario y la caja abierta; unos 12 MB por base (2,4 GB en total). El nombre de cada negocio y de cada producto lleva su subdominio (`cap-0137`), para detectar cualquier mezcla.

**Carga «dentro del proceso»** (`capacity:run`): el motor real —`completeSale`, búsqueda, escaneo, inicio del día, lista de ventas, ingreso— a través del mismo administrador de conexiones que usa la aplicación. Mezcla de un día normal de tienda: 50 % escaneos, 25 % búsquedas, 12 % ventas, 4 % inicio del día, 6 % lista de ventas, 3 % ingresos. «Calientes»: el 20 % de los negocios recibe el 80 % del tráfico; «parejo»: todos por igual (lo más exigente para la rotación de conexiones).

**Carga por HTTP** (`capacity:http`): peticiones reales a la aplicación ya compilada (`next build` + `next start`), con la cookie de sesión de cada negocio, a `/`, `/productos`, `/ventas`, `/vender`, `/reportes/ventas` y `/api/health`. Revisa en **cada respuesta** que no aparezca el nombre de otro negocio.

**Verificación al final de cada corrida:** por cada negocio, las ventas guardadas = las confirmadas al cliente (± las dudosas), ninguna venta de otro negocio, el inventario bajó exactamente lo vendido y `verifyBooks` (el mismo `pnpm db:verify`) sin problemas.

## 3. Resultados

### 3.0 A la escala que vas a usar: 20 y 50 negocios

Mismo método que abajo (motor real, mezcla de un día normal de tienda, tráfico parejo sobre todos los negocios, 45 s de calentamiento y 60 s medidos), con una caja cada ~8 s por cajero: **20 negocios ≈ 40 cajas ≈ 5 operaciones por segundo; 50 negocios ≈ 100 cajas ≈ 12 por segundo**. «Fábrica» es Postgres de 100 conexiones y el presupuesto de 60 de la aplicación (caben 30 negocios abiertos); «ajustada» es Postgres 200 y presupuesto 160 (caben 80).

| Negocios · configuración · carga | Hecho | Escaneo p50 / p95 | Venta p50 / p95 | Conexiones | Errores |
| --- | --- | --- | --- | --- | --- |
| 20 · fábrica · 5 ops/s (40 cajas) | 5,0 | 15 / 48 ms | 79 / 135 ms | 40 | 0 |
| 20 · fábrica · 15 ops/s (×3) | 15,0 | 13 / 24 ms | 66 / 107 ms | 41 | 0 |
| 20 · fábrica · a tope | **165** | 106 / 411 ms | 399 / 621 ms | 41 | 0 |
| 50 · fábrica · 12 ops/s (100 cajas) | 12,0 | 23 / 99 ms | 101 / 189 ms | 60 | 0 |
| 50 · fábrica · 36 ops/s (×3) | 35,9 | 64 / 223 ms | 186 / 430 ms | 61 | 0 |
| 50 · fábrica · a tope | 50,6 | 526 / 968 ms | 1192 / 1646 ms | 56 | 0 |
| 50 · **ajustada** · 12 ops/s | 12,0 | **14 / 54 ms** | 72 / 127 ms | 97 | 0 |
| 50 · **ajustada** · 36 ops/s (×3) | 36,0 | **12 / 25 ms** | 60 / 97 ms | 101 | 0 |
| 50 · ajustada · a tope | **158** | 121 / 254 ms | 536 / 746 ms | 101 | 0 |

**Por HTTP, con la aplicación compilada y 50 negocios (ajustada):** a 6 páginas por segundo (unas 100 cajas), `/` responde en 163 ms (mediana; p95 287 ms), `/productos` en 103 ms, `/ventas` en 82 ms y `/vender` en 67 ms; a tope, 22,9 páginas por segundo. **Cero respuestas anómalas y cero mezclas** (cada página trae el nombre de su propio negocio y de ninguno más). La primera petición a cada negocio tarda ~1 s (estaba frío).

Qué dicen:

- **Con 20 negocios no hay que tocar nada:** todos caben abiertos (40 conexiones de Postgres, memoria de la aplicación ~0,4–0,8 GB) y a tope se llegan a hacer 165 operaciones por segundo, 33 veces lo que hacen 40 cajas.
- **Con 50 negocios la fábrica funciona** (los 50 no caben abiertos a la vez, así que algunos se reabren y por eso el escaneo pasa de 14 a 23 ms), pero **ajustar dos números** deja a todos abiertos y recorta el tiempo a la mitad o menos: `POSTGRES_MAX_CONNECTIONS=200` y `TENANT_POOL_MAX_CONNECTIONS=160`. Cuesta ~100 MB más en Postgres (550 MiB en total contra 300).
- Una sola instancia de la aplicación alcanza de sobra para esta escala; la segunda instancia (sección 3.7) es para no depender de una sola, no para rendir más.
- Todas las corridas terminaron con la verificación negocio por negocio limpia: sin mezclas, sin diferencias de inventario ni de libros.

**Desde aquí, la prueba de estrés con 200 negocios** (hecha antes de ajustar la escala a 20–50): sirve para saber dónde está el techo.

### 3.1 Qué pasaba antes: las conexiones se agotaban

Con los valores de la Etapa 5 (hasta 50 negocios abiertos × 3 conexiones = 150, contra los 100 de Postgres), 40 trabajadores a tope sobre los 200 negocios:

| | Resultado |
| --- | --- |
| Conexiones a Postgres | pico de **96 de 97** utilizables |
| Errores | **533** («remaining connection slots are reserved…»), en todas las operaciones |
| Cobros dudosos | **21**, que ni con tres reintentos se supo si entraron |
| Verificación | sin mezclas (el aislamiento aguantó), pero la verificación misma falló 52 veces por falta de conexiones |

Es la peor clase de falla de un SaaS: **un negocio muy activo (o muchos a la vez) le quita el servicio a los demás**.

### 3.2 El presupuesto de conexiones

Ahora el tope de negocios abiertos es `mín(TENANT_POOL_MAX_ACTIVE, TENANT_POOL_MAX_CONNECTIONS ÷ conexiones por negocio)`; si todos están ocupados, el que llega espera. Misma carga, mismo equipo, **cero errores** en todas las configuraciones. Lo que cambia es cuántos negocios quedan abiertos y, con ellos, el ritmo:

| Configuración (Postgres / presupuesto) | Negocios abiertos | Conexiones (pico) | Operaciones/s | Escaneo p50 / p95 | Errores |
| --- | --- | --- | --- | --- | --- |
| Antes (100 / 150 sin tope) | 50 | 96 | 40 | 329 / 1196 ms | **533** |
| De fábrica nueva (100 / 60) | 30 | 52 | 36 | 930 / 1879 ms | 0 |
| Referencia: solo 20 negocios, sin rotación | 20 | 41 | **183** | 126 / 563 ms | 0 |
| Ajustada (300 / 240), tráfico concentrado | 120 | 232 | 115 | 193 / 740 ms | 0 |
| Todo abierto (500 / 420), tráfico concentrado | 200 | 351 | **132** | 167 / 585 ms | 0 |

(«Tráfico concentrado»: 20 % de los negocios recibe el 80 %. «A tope»: 40 trabajadores sin pausa; una caja real hace mucho menos.)

**Régimen estable, con todo abierto y tráfico parejo sobre los 200 negocios** (mezcla de un día normal, tras 2 minutos de calentamiento; 50 operaciones por segundo equivalen a unas 400 cajas con un movimiento cada 8 s):

| Ritmo pedido | Hecho | Escaneo p50 / p95 | Venta p50 / p95 | Errores |
| --- | --- | --- | --- | --- |
| 50 operaciones/s | **50,6** | **23 / 221 ms** | 120 / 2974 ms | 0 |
| 100 operaciones/s | **114,4** | **28 / 541 ms** | 126 / 2503 ms | 0 |
| 25 operaciones/s, **instalación de fábrica** (100 / 60) | 14,9 (no alcanza) | 2294 / 4579 ms | 3070 / 7056 ms | 0 |

Ojo con el arranque: cada negocio abierto arma sus consultas la primera vez que las usa, así que **los primeros minutos después de reiniciar la aplicación son más lentos** (la primera petición a cada negocio tarda 0,6–1,6 s; sin calentamiento, el escaneo p50 es de 167 ms en lugar de 23 ms). Las tablas de arriba sin «calentamiento» incluyen ese arranque en frío. La cola de las ventas (p95 de ~3 s) viene en parte de la mezcla de la prueba: el 3 % de operaciones son ingresos (hash de contraseña, que usa todos los núcleos); una tienda real inicia sesión una vez al día.

Cuando hay **más negocios activos que lugares** (fábrica o «ajustada» con tráfico parejo) el servidor no falla, pero cada petición a un negocio que no está abierto paga abrirle una conexión (~16 ms de CPU, ver 3.3) y el ritmo sostenido baja a 23–47 operaciones por segundo con respuestas de ~1 s. Para eso está la tarjeta «Negocios abiertos ahora» del Resumen y la tabla del RUNBOOK §17: **subir el presupuesto cuando los negocios que trabajan a la vez pasan de los lugares**.

### 3.3 Cuánto cuesta cada paso

Medido sobre 40 negocios (`client-cost.ts`, mediana):

| Paso | Tiempo | CPU |
| --- | --- | --- |
| Crear el cliente de un negocio (sin conectar) | 6 ms | — |
| **Abrir una conexión nueva** (y la primera consulta) | **20 ms** | **15 ms** |
| Una consulta con todo ya abierto | 1,7 ms | ~0 |
| Cada negocio abierto, en memoria | ~7 MB (el primero ~54 MB) | |

Lo caro es **abrir conexiones** (la autenticación de Postgres), no el cliente. Por eso la solución es mantener abiertas las conexiones que se usan —y el presupuesto garantiza que quepan—, no rediseñar el administrador. Una conexión abierta cuesta también ~4 MB en Postgres (757 MiB del contenedor con ~225 conexiones).

### 3.4 Fugas de memoria

Corrida de 5 minutos con el recolector forzado cada 10 s (`--expose-gc`), en el régimen de más rotación (6275 aperturas y cierres de negocios):

- **Memoria JavaScript viva: 570 → 594 → 570 → 570 → 572 → 571 → 570 → 571 → 571 → 569 → 571 → 584 → 569 …** MB: **plana** (pendiente −0,8 MB/min). No hay fuga.
- La memoria del proceso (RSS) llega a ~2 GB por la basura todavía sin recoger y el montón de V8; no sube sin parar. Reserva **3 GB** para la aplicación con 200 negocios abiertos.
- Un negocio abierto cuesta ~7 MB y se suelta al cerrarlo.

### 3.5 Vecino ruidoso

Un negocio castigado a propósito (12 trabajadores extra haciendo ventas, inicio del día y listas sin parar) mientras los otros 199 trabajan a su ritmo:

| | Mediana | p95 |
| --- | --- | --- |
| Los demás, sin castigar a nadie | 1084 ms | 2804 ms |
| Los demás, con un negocio castigado | 1192 ms (**+10 %**) | 2902 ms (**+3,5 %**) |
| El negocio castigado | 6328 ms | 11 373 ms |

El que abusa **se frena solo** (su pool es de 2 conexiones y su rol tiene `statement_timeout` de 60 s y 10 conexiones de tope); los vecinos casi no lo notan. No hubo errores.

### 3.6 PgBouncer

Se probó PgBouncer 1.23 en modo transacción (`auth_query`, una cuenta que solo puede llamar a una función), con los 200 negocios abiertos en la aplicación:

| | Conexiones reales a Postgres | Operaciones/s | Escaneo p50 |
| --- | --- | --- | --- |
| Directo (500 / 420) | 351 | 132 | 167 ms |
| Con PgBouncer | 119 | 65 | 395 ms |

Reduce las conexiones a Postgres a un tercio pero **a costa de la mitad del ritmo**, y con un rol por negocio **no hay un tope global**: PgBouncer arma un grupo por negocio, así que 200 negocios tocados casi a la vez abren 200 conexiones reales (la preparación de la prueba lo demostró: agotó Postgres antes de que PgBouncer ayudara). **Conclusión: no hace falta hasta ~200 negocios y no se recomienda por omisión.** Queda como perfil opcional de Compose, con su preparación probada (`pgbouncer:setup`: la cuenta no puede leer tablas, ni crear nada, ni ver la contraseña de una cuenta de superusuario).

### 3.7 Por HTTP: las páginas completas

Con la aplicación compilada, 200 negocios, tráfico parejo, 30 trabajadores a tope:

| Configuración | Peticiones/s | `/` p50 / p95 | `/productos` p50 / p95 | Mezclas | Respuestas anómalas |
| --- | --- | --- | --- | --- | --- |
| De fábrica (100 / 60) | 12,0 | 2089 / 3478 ms | 1385 / 7103 ms | **0** | 0 |
| Ajustada (500 / 420) | 19,4 | 1202 / 2305 ms | 766 / 4530 ms | **0** | 0 |
| Referencia: 5 negocios, todo abierto | 24,4 | — | — | 0 | 0 |
| 200 negocios, todo abierto (con CPU y memoria) | 18,7 | 1368 / 3028 ms | 862 / 4350 ms | 0 | 0 |

- **La página en sí es lo caro**, no tener muchos negocios: con 5 negocios se atienden 24 páginas por segundo; con 200, 19 (**−23 %**, el costo de más conexiones y más memoria). El proceso usó **0,85–0,88 núcleos**: la aplicación es de **un solo hilo** y ese es su techo en este equipo. La memoria de la aplicación: 761 MB con 5 negocios y **1880 MB** con 200 abiertos.
- Esto se resuelve con **más instancias**, no con una máquina más grande.

**Dos instancias a la vez** contra los mismos 200 negocios (60 s de carga en cada una, presupuestos de 120 conexiones cada uno): 9,9 + 9,8 peticiones por segundo (el equipo ya no da más: es la misma CPU), **cero** respuestas anómalas, **cero** mezclas y todas las páginas con su propio nombre. Suspender un negocio desde la línea de comandos (que no avisa a ninguna instancia) se notó en las dos a los **19,3 s** y reactivarlo a los **19,8 s**: dentro de los 20 s de `TENANT_DIRECTORY_TTL_MS`, como se documentó. (Una primera corrida con presupuestos de 200 + 200 contra un Postgres de 300 reprodujo el error de configuración que más daño hace: cientos de «Too many database connections» y páginas con error; por eso el aviso del arranque y la regla «la suma de los presupuestos debe caber».)

### 3.8 Tareas de la flota con 200 negocios

| Tarea | Tiempo |
| --- | --- |
| Alta de un negocio (receta completa, 4 a la vez) | 3,2 s en promedio; 200 negocios en 4,5 min |
| `tenants:migrate` con una migración nueva en los 200 | **4 min** (4 a la vez; ~1,2 s por negocio), 0 errores |
| `tenants:migrate` con todo al día | 2 s |
| Respaldo diario de los 200 + tienda + base central, **uno por uno** | **8,5 min** (508 s) |
| Lo mismo con `BACKUP_PARALLEL=4` | **3,4 min** (206 s); 202 archivos, 49 MB, 0 errores |
| `usage:collect` · `billing:sweep` · `tenants:reconcile` · `alerts:check` | 10 s · 1,5 s · 1,3 s · 1,5 s |

## 4. Revisión de seguridad

Se revisó contra la lista de amenazas de la propuesta (§6) y con búsquedas en el código. Estado de cada punto:

| # | Revisado | Hallazgo | Estado |
| --- | --- | --- | --- |
| S-1 | Disponibilidad: ¿puede un negocio (o muchos) quitarle el servicio a los demás? | Con 200 negocios activos se agotaban las conexiones de Postgres y fallaba TODO (sección 3.1) | **Corregido**: presupuesto + espera, aviso al arrancar, tarjeta en el Resumen, tabla en el RUNBOOK |
| S-2 | Privilegios de la base: ¿con qué cuenta atiende cada negocio? | La tienda adoptada (#1) atendía con la **cuenta principal del servidor** (dueña de todas las bases y roles): un error que ejecutara SQL ajeno en esa tienda tendría el servidor entero | **Corregido**: `pnpm tenants:limit-store` (rol `t_<id>`, solo datos); alerta mientras no se haga; `tenants:relink` lo recrea en un servidor nuevo |
| S-3 | Credenciales temporales | La contraseña del propietario (puesta por el equipo de la plataforma), la que da el soporte y la que pone un gerente **valían para siempre** | **Corregido**: cambio obligatorio en el servidor (pantalla, acciones, descargas); prueba de arquitectura de que ninguna ruta se la salta |
| S-4 | Archivos subidos (importación de productos, hasta 5 MB) | Un `.xlsx` es un zip: uno de 5 MB puede declarar cientos de megabytes, o una hoja que diga llegar a la fila 1 000 000, y **colgar la memoria o la CPU de todos los negocios** (en una sola tienda solo la afectaba a ella) | **Corregido**: se rechaza por el índice del zip antes de abrirlo y por filas/columnas declaradas |
| S-5 | ¿Cada acción del servidor revisa quién la pide? (regla 9) | Se revisaron las **100** acciones: todas autentican (las únicas públicas son entrar y salir) | **Regla automática** que lo mantiene |
| S-6 | Entrada del host / CSRF / redirecciones | **Probado en vivo con la aplicación compilada y 200 negocios**: la cookie de un negocio enviada al host de otro no abre nada (la página no trae ningún dato y manda a `/login`); una cookie inventada, tampoco. Hosts raros (mayúsculas, puerto, punto final, `x.localhost.evil.com`), `X-Forwarded-Host` y `/platform` desde un negocio: 404 o se ignoran. Las acciones del servidor de Next comparan `Origin` con el host: una página de otro negocio no puede enviar acciones a este. `?next=` solo admite rutas internas | Sin hallazgos |
| S-7 | Aislamiento entre negocios bajo carga | **0 mezclas** en todas las corridas (más de cien mil operaciones, más de quince mil ventas, 200 negocios, páginas por HTTP con el nombre de cada uno, dos instancias a la vez) | Sin hallazgos |
| S-8 | Inyección y marcado | SQL: todo con parámetros; el SQL armado a mano usa constantes o nombres generados por el sistema y validados (a `store-role` se le agregó la validación del nombre de la base). Sin `fetch` ni procesos desde datos del usuario (sin SSRF). `dangerouslySetInnerHTML` solo en etiquetas y QR: el SVG del código de barras dibuja el texto como trazos, y ahora una prueba lo vigila | Sin hallazgos (prueba nueva) |
| S-9 | Dependencias | `pnpm audit --prod`: 1 aviso moderado (`minimatch`, por `exceljs`): el patrón lo fija la biblioteca, no llega nada del usuario | Aceptado, anotado |
| S-10 | Varias instancias | El límite de intentos fallidos **por IP** vive en la memoria de cada instancia (con N instancias, N veces el cupo); el bloqueo **por usuario** vive en la base y vale para todas. Una suspensión tarda hasta `TENANT_DIRECTORY_TTL_MS` (20 s) en notarse en las otras instancias (medido: 19,3 s) | Documentado con la forma de acortarlo; limitador compartido: pendiente (sección 8) |
| S-11 | Cabeceras | CSP con `'unsafe-inline'` (Next inyecta los suyos); `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS desde Caddy | Conocido desde la Fase 6, sin cambio |
| S-12 | PgBouncer (si se enciende) | La función que consulta contraseñas solo devuelve las de roles que no son superusuario; la cuenta no puede leer tablas ni crear nada | Probado |

## 5. Los endurecimientos, en detalle

- **Contraseña temporal.** `User.mustChangePassword` (migración aditiva). Lo marcan: el alta del propietario, el soporte y quien restablece (no «Usuarios → Nuevo»: ahí la elige quien crea la cuenta). `requireSession` manda a `/cambiar-contrasena`; las acciones del servidor, las páginas y las descargas lo respetan porque todas pasan por ahí (`getUsableSession` para las rutas que no pueden redirigir); la propia pantalla usa la sesión «cruda» y la prueba de arquitectura impide que otro archivo lo haga. Cambiar la contraseña exige que sea distinta de la temporal y cierra las demás sesiones.
- **Rol de la tienda #1.** `limitStoreRole`: crea el rol, le da solo permisos de datos, **prueba que puede leer** (si no, no cambia nada), guarda la credencial nueva en la bóveda y el cambio se toma en menos de 20 s sin reiniciar. Idempotente; la cuenta principal sigue existiendo para migraciones, respaldos y `db:verify`.
- **Presupuesto de conexiones.** Cola de espera con tiempo límite; una conexión ociosa se cierra a los 10 s; una operación espera hasta 10 s por una conexión libre de su negocio; mantiene la regla de no cerrar nunca un negocio con operaciones en curso.

## 6. Verificación

| Comprobación | Resultado |
| --- | --- |
| `pnpm lint` · `typecheck` · `format:check` | En verde |
| `pnpm test` (unidad + integración, modo `single`) | **103 archivos, 1460 pruebas, todas pasan** (Etapa 5: 100 y 1414). Se corrió con este mismo código; después solo cambiaron documentos y se repitieron lint, tipos, formato y las pruebas de unidad |
| Integración en modo estricto `TENANCY_MODE=multi` | **55 archivos, 777 pruebas, todas pasan** (Etapa 5: 757) |
| Navegador: panel de la plataforma | **20 pasan** (incluye el cambio obligatorio de la contraseña del propietario y la tarjeta de conexiones) |
| Navegador: tienda en `single` y en `multi` | **89 pasan en `single` y 89 en `multi`** (Etapa 5: 88 y 88; la nueva es el cambio obligatorio de contraseña de quien la recibe de otra persona) |
| Capacidad: 200 negocios, todas las corridas | 0 mezclas, 0 diferencias de inventario o libros; 0 errores con la configuración documentada |
| Ensayo en Docker | Pasó (ver abajo); cazó un error propio, ya corregido |

Pruebas nuevas: presupuesto, espera y vencimiento del administrador de conexiones (4); contraseña temporal en el servicio de sesiones, el primer propietario, el restablecimiento, el alta y el soporte (9); rol de la tienda #1 (5); cuenta de PgBouncer (5); archivos bomba (15); regla de «cada acción revisa quién la pide» y de la sesión sin control (4); variables de entorno y presupuesto (5); código de barras como HTML (1); dos recorridos de navegador (el cambio obligatorio en la tienda y en el panel) y la tarjeta de conexiones.

### Ensayo en Docker

Con las imágenes de producción, **actualizando la instalación de la Etapa 5** (su volumen, la tienda #1 y un negocio):

| Qué se ensayó | Resultado |
| --- | --- |
| Actualización | La migración nueva se aplicó en las dos bases; Postgres arrancó con `max_connections=300` (el `command` nuevo de Compose); la aplicación avisó en el registro `pool.budget` (presupuesto 120, caben 60, servidor 300). |
| Rol limitado de la tienda #1 | La alerta «atiende con la cuenta principal» aparecía; `tenants:limit-store tienda` la quitó; la tienda siguió respondiendo 200 sin reiniciar; `db:verify --tenant tienda` dio «Libros cuadrados»; la conciliación quedó limpia. |
| Contraseña temporal | Un negocio dado de alta por la línea de comandos quedó con `mustChangePassword = true` para su propietario. |
| Dos instancias | `dc up -d --scale app=2`: Caddy descubrió las dos direcciones (`dynamic a`), las dos recibieron tráfico, y con una **detenida** las 20 peticiones siguientes dieron 200. |
| Respaldo en paralelo | `BACKUP_PARALLEL=4` respaldó la tienda, el negocio y la base central, y `backups:status` los dio «al día». |
| PgBouncer | `pgbouncer:setup`, el perfil encendido, `TENANT_DB_HOST=pgbouncer`: la tienda #1 (ya con rol limitado), el otro negocio y el nuevo respondieron 200 y dejaron entrar; al apagarlo, todos volvieron a atender directo. |
| Caddy | El `Caddyfile.multi` nuevo valida (`caddy validate`). |

### Errores propios que cazaron las pruebas durante la etapa

- **Variable vacía = servidor desconocido (la cazó el ensayo en Docker).** Al pasar `TENANT_DB_HOST` y `TENANT_DB_PORT` desde Compose, sin valor llegan **vacías** y `serverEndpoint()` las tomaba por un valor: con `TENANT_DB_HOST=""` toda la plataforma habría dado 503. Ahora vacío es lo mismo que no definido (prueba nueva). Es la misma trampa que ya se había visto en la Etapa 3 con otras variables.
- Un archivo de 4 bytes llamado `.xlsx` (dañado) se reportaba como «hoja demasiado grande» en vez de «no pudimos leer el archivo». Ahora se distingue lo dañado de lo desmesurado.
- Una migración con «password» en su nombre rompía una prueba que busca esa palabra en la auditoría (el nombre de la migración viaja en el detalle): se llamó `user_temporary_credentials`.
- La base de pruebas de navegador de la tienda necesita `prisma migrate deploy` cuando hay una migración nueva (no se aplica sola): sin eso, todo el inicio de sesión falla.
- Mi primera corrida con dos instancias sumó presupuestos de 400 contra un Postgres de 300 y reprodujo «Too many database connections» con páginas de error que devuelven 200: de ahí el aviso al arrancar.
- Mis pruebas de navegador del cambio obligatorio chocaron con una etiqueta ambigua («Contraseña» también coincide con «Contraseña nueva») y con que el formulario se vacía después de cada envío.

## 7. Lo que no se pudo ensayar aquí

- **Un dominio real con certificado** (Let's Encrypt, comodín) y `DEPLOYMENT=production` dentro de Docker con ese dominio.
- **Un Postgres administrado** por un proveedor (RDS y similares): el respaldo usa `pg_dump` contra el servidor al que apunte `PGHOST`, y `pgbouncer:setup` y `tenants:limit-store` necesitan una cuenta que cree roles.
- **Un segundo servidor de bases de datos.** `Tenant.dbServerId` existe desde la Etapa 0, pero `serverEndpoint()` hoy solo conoce el servidor `primary`: repartir negocios en varios servidores exige un mapa de servidores y que el alta, el respaldo y la conciliación lo usen. Con ~200 negocios por servidor no hizo falta.
- **Cargas más grandes que 200 negocios** y **bases grandes** (las de prueba pesan ~12 MB; el tiempo de un respaldo o una restauración crece con el tamaño).
- **Cifras de un servidor real.** Las de arriba salen de un portátil de 4 núcleos con la carga y todo lo demás en la misma máquina.

## 8. Qué queda

- **Limitador de intentos compartido** entre instancias (hoy por proceso) y **propagación inmediata** de una suspensión entre instancias (hoy hasta 20 s; baja con `TENANT_DIRECTORY_TTL_MS`).
- **Varios servidores de bases de datos** (mapa de servidores) cuando un servidor deje de alcanzar.
- **Actualizar con varias instancias:** levantar primero una (aplica las migraciones al arrancar) y luego escalar; hoy no hay un candado entre instancias para la migración de la flota (cada base se protege con el candado de Prisma, pero la plantilla se rehace sin él).
- **La lista de negocios del panel** muestra todos en una tabla: con más de ~500 conviene paginar y buscar.
- Lo ya anotado: avisos por correo, recuperación a un instante exacto, pasarela de pago.
