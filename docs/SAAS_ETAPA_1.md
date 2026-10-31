# SaaS multi-negocio — Etapa 1: plano de control y superadministrador con 2FA

> Rama `saas/etapa-0` (la Etapa 1 se construye encima). Propuesta aprobada: [`SAAS_PROPUESTA.md`](SAAS_PROPUESTA.md). Informe anterior: [`SAAS_ETAPA_0.md`](SAAS_ETAPA_0.md). Operación diaria: [`RUNBOOK.md`](RUNBOOK.md) §12.
>
> **Criterio de la etapa:** "Entras a `admin.…` con 2FA; todo queda auditado." — **cumplido y probado** (secciones 3 y 6).

## 1. Qué se entregó

| Pieza | Dónde | Para qué |
| --- | --- | --- |
| Base central (plano de control) | `prisma/control/schema.prisma` + migración `init_control` | Negocios (`Tenant`), superadministradores (`PlatformUser`), sesiones (`PlatformSession`) y auditoría de solo inserción (`PlatformAuditLog`). **Nunca** guarda ventas, inventario ni clientes. |
| Bóveda de secretos | `src/lib/tenancy/vault.ts` | Cifra con AES-256-GCM lo que hay que poder recuperar: la contraseña de la base de cada negocio y el secreto del 2FA. Llave maestra fuera de la base, versionada y rotable. |
| 2FA (TOTP, RFC 6238) | `src/lib/totp.ts` | Códigos de 6 dígitos compatibles con Google/Microsoft Authenticator, Authy, 1Password… Solo `node:crypto`. |
| Acceso del superadministrador | `src/modules/platform/service.ts` | Contraseña (Argon2id, 12+ caracteres) y luego código; bloqueo por intentos; códigos de un solo uso; sesión corta con cierre por inactividad. |
| Enrutado por host | `src/lib/tenancy/host.ts`, `src/proxy.ts` | `admin.<dominio>` abre el panel; una tienda nunca puede abrirlo; un host desconocido recibe 404. |
| Panel (esqueleto) | `src/app/platform/**` | Resumen, Negocios (vacío hasta la Etapa 3), Administradores (alta, desactivar, restablecer 2FA, desbloquear), Auditoría (filtros y paginación), Mi cuenta. |
| Comandos | `scripts/platform.ts`, `scripts/control-setup.ts` | `pnpm control:setup`, `platform:create-admin`, `platform:reset-2fa`, `platform:unlock`, `platform:gen-key`, `platform:rotate-key`. |
| Pruebas | ver sección 6 | Unitarias, de integración contra la base central real, de arquitectura y de navegador. |

Lo que **no** cambia: ninguna regla de ventas, inventario, caja ni reportes; ninguna tabla ni migración de un negocio; el modo actual (`TENANCY_MODE=single`) sigue idéntico.

## 2. Cómo verlo funcionando

```bash
pnpm control:setup                 # crea y migra la base central (local)
pnpm platform:gen-key              # imprime una llave; guárdala en PLATFORM_MASTER_KEY
pnpm platform:create-admin         # tu usuario y contraseña (nadie más la conoce)
TENANCY_MODE=multi PLATFORM_HOST=admin.localhost pnpm dev
```

Variables necesarias (ver `.env.example`): `TENANCY_MODE=multi`, `PLATFORM_HOST`, `CONTROL_DATABASE_URL`, `PLATFORM_MASTER_KEY`. Abre `http://admin.localhost:3000`: ingresas con tu contraseña, escaneas el QR con tu aplicación de autenticación y escribes el código. Desde la segunda vez solo pide contraseña + código.

## 3. El acceso, paso a paso

1. **Usuario y contraseña** → si son correctos se abre una sesión *pendiente* (vence en 10 minutos y **no** da acceso al panel).
2. **Primera vez:** pantalla con el código QR y la clave para teclear a mano; se confirma con el primer código y queda activado el 2FA. **Después:** solo se pide el código.
3. Al confirmar el código la sesión pendiente se cambia por una **completa con un token nuevo** (un token viejo no sirve de nada). Dura 8 horas y se cierra a los 30 minutos sin actividad.

Protecciones:

| Amenaza | Medida |
| --- | --- |
| Adivinar contraseñas o códigos | 5 fallos bloquean la cuenta 15 minutos; **el contador es compartido entre contraseña y código y solo se reinicia al completar el acceso** (quien ya conoce la contraseña no puede probar códigos entrando una y otra vez). Además, 10 fallos por IP cada 15 minutos. |
| Repetir un código visto por encima del hombro | Cada código se acepta **una sola vez** (se guarda el último intervalo usado y se reclama de forma atómica: dos intentos simultáneos con el mismo código, solo entra uno). |
| Saber si un usuario existe | Mismo mensaje y mismo tiempo de respuesta para usuario inexistente y contraseña errónea; el nombre escrito de un usuario inexistente **no se guarda** (a veces se pega ahí la contraseña). |
| Robo de la base central | Contraseñas con Argon2id; tokens de sesión solo como hash; secretos 2FA cifrados con una llave que **no** está en la base. Un sobre cifrado copiado a otro registro no descifra (el contexto va autenticado). |
| Un administrador abusa o se equivoca | Agregar, desactivar o restablecer a alguien pide **la contraseña de quien lo hace** de nuevo; nadie puede desactivarse a sí mismo; siempre queda al menos un administrador activo (incluso con dos desactivaciones simultáneas); desactivar cierra sus sesiones. |
| Borrar huellas | La auditoría es de solo inserción **dentro de la base** (un disparador impide `UPDATE` y `DELETE`) y nunca recibe contraseñas, códigos ni secretos (se filtran por nombre de campo). |
| Un negocio entra al panel (o al revés) | Cookie distinta (`boutique_platform`, con prefijo `__Host-` en producción), host distinto, y el proxy responde 404 a `/platform` desde cualquier host que no sea el del panel. Una prueba de arquitectura impide que el código del panel importe la base de un negocio y que el de un negocio importe la central. |

## 4. Decisiones y hallazgos de la etapa

1. **El panel solo existe en modo multi-negocio.** Cuando una acción del servidor redirige —o la página que se vuelve a dibujar tras una acción redirige— Next pide la página destino *desde dentro del servidor* a `http://localhost:<puerto>` y **descarta el encabezado `Host`** (se comprobó: el `fetch` de Node ignora un `Host` forzado; el origen interno lo fija `__NEXT_PRIVATE_ORIGIN`). En modo `single` cualquier host es "el negocio": la pantalla de la tienda aparecía dentro del panel al cerrar sesión. En modo `multi` ese host interno es desconocido → 404 → Next hace que **el navegador** navegue por su cuenta, que sí conserva el host. Por eso `PLATFORM_HOST` exige `TENANCY_MODE=multi` (lo validan `env.ts`, `host.ts` y pruebas). Consecuencia buena: lo mismo protege a las tiendas de la Etapa 2.
2. **Las acciones del panel no usan `redirect()`**: devuelven `redirectTo` y el navegador navega (`useRedirectOnState`). Evita un viaje extra y depender del comportamiento anterior.
3. **Un solo contador de fallos para contraseña y código** (ver tabla). Sin esto, el 2FA se podía atacar por fuerza bruta reiniciando el contador con la contraseña.
4. **Dependencia nueva, justificada:** `qrcode-generator@2.0.4` (MIT, sin dependencias, ~25 KB) para dibujar el QR **en el servidor** sin mandar el secreto a ningún tercero. Alternativa descartada: mostrar solo la clave a mano (peor experiencia y más errores).
5. **El primer alta de 2FA** la hace quien conoce la contraseña temporal: se entrega por un medio seguro y la persona debe entrar de inmediato (el comando `create-admin` lo recuerda). Si alguien más la usara primero, el administrador lo ve en la auditoría y puede restablecer el 2FA.
6. **Restricciones en la propia base** (migración `init_control`): formato del subdominio, un negocio activo debe tener base, rol y credencial, un 2FA confirmado debe tener secreto, auditoría de solo inserción.
7. **Aún no hay planes, suscripciones ni pagos:** llegan en la Etapa 4. La lista de *Negocios* está vacía a propósito hasta la Etapa 3 (aprovisionamiento).

## 5. Qué queda para las etapas siguientes

- **Etapa 2:** el directorio de hosts pasa de la tabla de prueba a la tabla `Tenant`; el negocio actual se registra como negocio #1; id del negocio en el limitador y el registro; `/api/health` de plataforma por separado; `TENANCY_MODE=multi` habilitado en producción (hoy `env.ts` lo rechaza) junto con `docker-compose.prod.yml`, `Caddyfile` (certificado comodín) y el arranque (`entrypoint.sh` debe migrar también la base central).
- **Etapa 3:** reautenticación reciente para acciones destructivas sobre negocios (la confirmación con contraseña ya existe para las de administradores) y alta/baja automática.
- **Respaldos de la base central:** hasta la Etapa 5 es manual (ver `RUNBOOK.md` §12). La llave maestra **debe** respaldarse fuera del servidor.

## 6. Verificación

Corridas finales sobre el estado que se entrega (2026-10-31):

| Comprobación | Resultado |
| --- | --- |
| `pnpm lint`, `eslint --max-warnings 0`, `pnpm typecheck`, `pnpm format:check` | Limpios |
| `pnpm test` (unitarias + integración contra Postgres real, modo `single`) | **1101 pruebas, 81 archivos, todas verdes** (antes de la etapa: 987) |
| Integración completa en modo estricto `TENANCY_MODE=multi` | **615 pruebas verdes** (antes: 576) |
| `pnpm build` (producción, Cache Components) | Compila; las 9 rutas `/platform/*` incluidas |
| `pnpm test:e2e` (la tienda, 88 pruebas, base aparte `boutique_pos_e2e`) | **88 verdes** (sin cambios: la tienda no se tocó) |
| `pnpm test:e2e:platform` (el panel, navegador real en `admin.localhost`) | **6 verdes** |
| Recorrido a mano en el navegador | Contraseña → QR → código → panel; código incorrecto; cerrar sesión; alta de un segundo administrador (con error de confirmación que conserva lo escrito); desactivarlo; auditoría; tienda de demostración abierta junto al panel en `tienda.localhost` |
| Aislamiento por host (`curl` con `Host` falsificado) | `/platform` desde un negocio → 404; host desconocido → 404; `X-Forwarded-Host` falsificado no se obedece; salud del panel y de la tienda → 200 |

Pruebas nuevas de la etapa: **114 de Vitest** (la suite pasó de 987 a 1101) más **6 de navegador**. Son 75 unitarias —entre ellas los **vectores oficiales del RFC 6238**, la bóveda (cifrado, contexto, manipulación, rotación), el enrutado por host y el proxy, la validación del entorno y las guardas de arquitectura— y 39 de integración contra la base central real (alta, primer acceso, código de un solo uso y carrera de dos intentos simultáneos, bloqueo, sesiones, administración, auditoría de solo inserción, restricciones de la base, rotación de llave).

**Errores propios encontrados y corregidos durante la etapa:** (1) la pantalla de la tienda aparecía dentro del panel por el redirect interno de Next (sección 4, punto 1); (2) mi ruta de salud usaba `dynamic = "force-dynamic"`, incompatible con Cache Components (rompía la compilación); (3) los formularios borraban lo escrito al fallar; (4) la lista de administradores no se refrescaba tras un alta.
