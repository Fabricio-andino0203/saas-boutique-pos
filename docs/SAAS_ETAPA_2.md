# SaaS multi-negocio — Etapa 2: negocios por subdominio y modo multi-negocio listo para producción

> Rama `saas/etapa-0` (la Etapa 2 se construye encima). Propuesta aprobada: [`SAAS_PROPUESTA.md`](SAAS_PROPUESTA.md). Informes anteriores: [`SAAS_ETAPA_0.md`](SAAS_ETAPA_0.md), [`SAAS_ETAPA_1.md`](SAAS_ETAPA_1.md). Operación: [`RUNBOOK.md`](RUNBOOK.md) §13.
>
> **Criterio de la etapa:** «las pruebas de aislamiento de §6 en verde; la tienda actual sigue vendiendo igual» — **cumplido y probado** (secciones 4 y 7).

## 1. Qué se entregó

| Pieza | Dónde | Para qué |
| --- | --- | --- |
| Directorio de hosts desde la base central | `src/lib/tenancy/control-directory.ts`, `directory.ts`, `slug.ts`, `tenant-url.ts` | `<subdominio>.<TENANT_BASE_DOMAIN>` se busca en la tabla `Tenant`; se abre la credencial de su base con la bóveda y se arma la URL. Con caché corta, deduplicación de consultas y tolerancia a que la base central se caiga un rato. |
| Estados del negocio en cada petición | `src/proxy.ts`, `host.ts`, `unavailable-page.ts` | Activo → el sistema. Suspendido o pendiente de baja → pantalla «Cuenta suspendida» (403) sin tocar su base. En preparación, fallido o dado de baja → 404. Directorio sin respuesta → 503 (nunca se adivina). |
| La tienda actual como negocio #1 | `src/modules/platform/tenants.ts`, `pnpm platform:adopt-store` | Se registra la base que ya está en uso **sin mover ni tocar sus datos**; la credencial queda cifrada en la bóveda. |
| Suspender y reactivar | `pnpm platform:suspend` / `platform:reactivate` / `platform:tenants` | Cambio de estado auditado; se nota en segundos. (Los botones del panel llegan con la Etapa 3.) |
| El negocio en el limitador y el registro | `modules/auth/throttle.ts`, `lib/logger.ts`, `instrumentation-node.ts` | El contador de intentos fallidos es por **negocio + IP**; las líneas del registro llevan `tenant`. En una sola tienda todo queda igual que antes. |
| Salud de la plataforma | `app/api/health/route.ts`, `lib/tenancy/platform-health.ts` | `/api/health` revisa la base del negocio en su dirección y, en cualquier otra (la prueba de Docker llama a `127.0.0.1`), la base central y la llave maestra. |
| HTTPS por subdominio | `Caddyfile.multi`, `app/api/internal/tls-allowed/route.ts`, `lib/tenancy/tls.ts` | Certificado bajo demanda: Caddy solo lo emite si la app confirma que el nombre es del panel o de un negocio que existe. |
| Despliegue | `docker-compose.prod.yml`, `docker/entrypoint.sh`, `.env.production.example` | El contenedor crea y migra la base central al arrancar; el compose pasa las variables nuevas y elige el Caddyfile. `TENANCY_MODE=multi` ya se admite en producción (`env.ts`). |
| Respaldo de la base central | `docker/backup/backup.sh`, `restore.sh` | Con varios negocios se respalda también la base central (`control-*.dump.enc`), cifrada y comprobada. |
| Cookie de sesión endurecida | `src/lib/session-cookie.ts` | Con varios negocios en producción lleva el prefijo `__Host-`: otro subdominio no puede plantarla. |
| Comandos por negocio | `scripts/lib/tenant-run.ts` | `create-owner`, `expire-layaways`, `db:reconcile` y `db:verify` reciben `--tenant <subdominio>`; `job:expire-layaways --all` recorre todos. |
| Panel: lista de negocios | `app/platform/(panel)/negocios` | Muestra cada negocio con su dirección, estado y versión de datos. |

Lo que **no** cambia: ninguna regla de ventas, inventario, caja ni reportes; ninguna tabla ni migración de un negocio; con `TENANCY_MODE=single` (el valor por omisión) el sistema es idéntico al de antes.

## 2. Cómo verlo funcionando (en tu equipo)

En PowerShell (las variables solo valen en esa ventana; no las pongas en `.env`, porque entonces también `pnpm test` y `db:seed` correrían en modo multi):

```powershell
$env:CONTROL_DATABASE_URL = "postgresql://boutique:<contraseña>@localhost:5432/boutique_pos_control?schema=public"
pnpm control:setup                       # crea y migra la base central
pnpm platform:gen-key                    # imprime una llave
$env:PLATFORM_MASTER_KEY = "<la llave>"  # guárdala también fuera de este equipo
pnpm platform:create-admin               # tu usuario y contraseña del panel
$env:TENANT_BASE_DOMAIN = "localhost"
pnpm platform:adopt-store --slug tienda --name "Mi Boutique"   # tu tienda de DATABASE_URL = negocio #1
$env:TENANCY_MODE = "multi"; $env:PLATFORM_HOST = "admin.localhost"
pnpm dev
```

(En bash: `TENANCY_MODE=multi PLATFORM_HOST=admin.localhost TENANT_BASE_DOMAIN=localhost pnpm dev` con las demás variables exportadas.)

- La tienda, como siempre, en `http://tienda.localhost:3000` (mismo usuario y datos de hoy).
- El panel en `http://admin.localhost:3000`: en **Negocios** aparece la tienda como el #1.
- `pnpm platform:suspend tienda` → la dirección de la tienda muestra «Cuenta suspendida»; `pnpm platform:reactivate tienda` → vuelve a operar. Los datos no se tocan.

## 3. Cómo se atiende una petición

1. El proxy toma el `Host` y lo clasifica (`src/lib/tenancy/host.ts`):
   - es el **panel** (`PLATFORM_HOST`) → panel de la plataforma;
   - es `<slug>.<dominio base>` de un negocio → se busca en el directorio (caché de 20 s; 5 s si «no existe»; máximo 2 000 nombres recordados);
   - cualquier otra cosa → 404, **sin consultar ninguna base** (un nombre que no puede ser un negocio ni siquiera llega a la base central).
2. Según el estado del negocio: activo sigue; suspendido muestra la pantalla de cuenta suspendida; los demás, 404.
3. Al ejecutar la petición, `db` vuelve a resolver el negocio **solo** del `Host` y presta el pool de su base. Sin negocio, no hay base (falla cerrado).
4. Nada que mande el navegador (`X-Forwarded-Host`, cabeceras propias, cookies, rutas, parámetros) interviene.

| Estado en la base central | Qué ve quien entra |
| --- | --- |
| `ACTIVE` | El sistema de ese negocio. |
| `SUSPENDED`, `PENDING_DELETION` | «Cuenta suspendida» (403) en todas las pantallas. |
| `PROVISIONING`, `FAILED`, `DELETED` | 404. |
| (la base central no responde) | Un negocio ya conocido sigue hasta 10 minutos; uno desconocido recibe 503. |

## 4. Aislamiento: lo que se comprobó (propuesta §6)

| Amenaza | Prueba |
| --- | --- |
| Ids repetidos en dos negocios | Dos negocios con **los mismos ids** (`prod-same`, `user-same`…) se atienden por su host sin mezclarse; 200 peticiones simultáneas alternadas entre dos hosts, cada una en su base (`tenant-runtime.test.ts`). |
| Token de A usado en B | `findSession(tokenA)` por el host de B → nada; en el navegador, la cookie de A copiada al host de B no abre B (`tenants.spec.ts`). |
| Host falsificado | `X-Forwarded-Host`, `Forwarded`, `X-Tenant`… no cambian de negocio; `tienda-a.evil.com`, `tienda-a.localhost.evil.com`, `x.tienda-a.localhost`, `localhost`, `127.0.0.1` y vacío → sin base. |
| Negocio suspendido | Cae solo ese negocio y el otro sigue; suspender y reactivar desde otro proceso se nota en menos de un segundo con la caché de pruebas; los datos no se tocan. |
| Sin contexto | Fuera de una petición y sin negocio en contexto, `db` lanza `TenantContextError`. |
| Fuga por caché o estado global | El limitador de intentos cuenta por negocio + IP; el pool y el directorio son por nombre de host; una prueba de arquitectura (Etapa 0) prohíbe `use cache` y clientes de base fuera de `tenancy/`. |
| Credencial cambiada de lugar | Una credencial copiada de un negocio a otro **no descifra** (el contexto va atado a la fila) y no abre ninguna base; un servidor desconocido falla en vez de caer en otro. |
| Cookie plantada por otro subdominio | Con varios negocios en producción solo vale `__Host-boutique_session`. |
| Certificados | Caddy solo emite para nombres que la app confirma (panel o negocio existente); lo interno no es alcanzable desde afuera. |

Las pruebas de **límites del plan** de la propuesta §6 llegan con los planes (Etapa 4).

## 5. Decisiones y hallazgos de la etapa

1. **El servidor sirve la configuración anterior solo si la que falla es la base central.** Mi primera versión también lo hacía ante un error de la propia fila (credencial que no descifra, servidor desconocido), lo que escondía el problema: una prueba lo detectó y ahora esos errores son definitivos (503) y solo la caída de la base central es «transitoria».
2. **`/api/health` ya no es una sola cosa.** En modo multi, la prueba de Docker llama a `127.0.0.1`, que no es de ningún negocio; si respondiera por «la base de un negocio» el contenedor quedaría siempre no saludable y Caddy (que espera a la app) nunca arrancaría. Ahora responde por la plataforma; la salud de cada negocio se pide por su dirección.
3. **El negocio #1 se registra con la cuenta con la que ya se conecta** (la principal de Postgres). No se le crea un rol limitado porque eso exige tocar la base de la tienda; los negocios nuevos (Etapa 3) sí tendrán un rol propio con permisos solo de datos. Queda como endurecimiento pendiente para el #1.
4. **Certificados «bajo demanda» en vez de comodín.** No necesita credenciales de tu proveedor de DNS ni un Caddy compilado a la medida y la app decide qué nombres existen. Su límite es el de la autoridad certificadora (Let's Encrypt limita la emisión por dominio y semana); para un volumen alto de altas el RUNBOOK explica el cambio a certificado comodín.
5. **La pantalla de cuenta suspendida no lleva datos del negocio** (ni su nombre): se responde antes de leer cookies y sin consultar su base.
6. **El panel y los comandos usan el mismo directorio.** Un cambio de estado desde la línea de comandos llega a los servidores por la caché (`TENANT_DIRECTORY_TTL_MS`); en el despliegue previsto (una sola instancia) se invalida de inmediato en el mismo proceso.
7. **`TENANT_POC_DIRECTORY` desapareció:** el directorio de la prueba de concepto era una tabla fija en una variable de entorno.
8. **Node no resuelve `*.localhost`** en algunos sistemas (Chromium sí). Para correr las pruebas de la tienda en modo multi, `page.request` pasa por una precarga de `dns` que manda esos nombres a `127.0.0.1` (`tests/e2e/support/localhost-dns.cjs`); sin ella 5 pruebas daban `ENOTFOUND`.
9. **Producción multi exige el panel** (`PLATFORM_HOST`), dominios reales (ni `localhost` ni textos de ejemplo) y la llave maestra: la configuración inválida impide arrancar.

## 6. Qué queda para las etapas siguientes

- **Etapa 3:** alta automática de negocios con su base y su rol propios, migración de toda la flota, botones de suspender/reactivar/eliminar en el panel (con reautenticación), conciliación de bases huérfanas.
- **Etapa 4:** planes, suscripciones, límites y módulos; un negocio vencido pasa por gracia → solo lectura (hoy «suspendido» es todo-o-nada).
- **Etapa 5:** respaldo y restauración **por negocio**, métricas y alertas.
- **Pendientes de endurecimiento:** rol limitado para el negocio #1; invalidación del directorio entre varias instancias (hoy por vencimiento de caché); el limitador de intentos sigue en memoria de un proceso.

## 7. Verificación

Corridas finales sobre el estado que se entrega (2026-11-01):

| Comprobación | Resultado |
| --- | --- |
| `pnpm lint`, `eslint --max-warnings 0`, `pnpm typecheck`, `pnpm format:check` | Limpios |
| `pnpm test` (unitarias + integración contra Postgres real, modo `single`) | **1195 pruebas, 84 archivos, todas verdes** (antes de la etapa: 1101) |
| Integración completa en modo estricto `TENANCY_MODE=multi` | **645 pruebas verdes** (antes: 615) |
| `pnpm test:e2e:platform` (panel + dos negocios por subdominio, navegador real) | **13 verdes** (antes: 6) |
| `pnpm test:e2e` (la tienda, 88 pruebas, modo `single`) | **88 verdes** (sin cambios) |
| `E2E_TENANCY=multi pnpm test:e2e` (**las mismas 88 pruebas con la tienda como negocio #1** en `tienda.localhost`) | **88 verdes** |
| Ensayo en Docker (imagen de producción + Postgres + Caddy, modo multi) | Arranque con base central creada y migrada sola; `healthy`; negocio #1 registrado y atendido por HTTPS con certificado bajo demanda; nombre inventado sin certificado; `/api/internal/*` → 404 desde afuera; suspender y reactivar desde el contenedor visibles por Caddy; respaldo de la tienda y de la base central, ambos restaurados y verificados (`db:verify` en una base restaurada, `reconcile`, `expire-layaways --all`) |

Pruebas nuevas de la etapa: **94 de Vitest** (1101 → 1195) y **7 de navegador** del panel y los negocios. Son, entre otras: el directorio (formato del subdominio, reservados, caché, deduplicación, tope de memoria, caída transitoria vs. error definitivo), el proxy (suspendido, directorio caído, salud y pregunta de certificados en cualquier host), la validación del entorno de producción, el limitador y el registro por negocio, la cookie `__Host-`, y —contra Postgres real— dos negocios con los mismos ids atendidos por host, hosts falsificados, credenciales cambiadas de lugar, suspensión y registro del negocio #1.

**Errores propios encontrados y corregidos durante la etapa:** (1) servía la configuración vieja ante un error definitivo de la fila del negocio (lo detectó una prueba; sección 5, punto 1); (2) mi comprobación de «esto viene de Caddy» miraba `X-Forwarded-For`, pero Next lo añade a todo lo que recibe: la pregunta de certificados siempre respondía que no. El ensayo en Docker lo mostró; se quitó y la protección real es el bloqueo de `/api/internal/*` en Caddy; (3) 5 pruebas de la tienda en modo multi fallaban por `ENOTFOUND tienda.localhost` desde Node (corregido con la precarga de DNS de las pruebas); (4) los comandos mostraban la traza completa ante un uso incorrecto (ahora solo el mensaje).

**Lo que no se pudo ensayar aquí:** un dominio real con certificados de Let's Encrypt (el ensayo usó la autoridad interna de Caddy; la lógica de «preguntar a la app» es la misma) y `DEPLOYMENT=production` dentro de Docker (rechaza dominios locales; sus reglas están cubiertas por las pruebas de `env.ts`). Quedan en el ensayo de instalación con el dominio real (RUNBOOK §13).
