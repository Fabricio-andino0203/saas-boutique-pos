# Plantilla: subir una versión nueva al servidor (Railway)

Para hacerlo tú, a mano, sin depender de nadie. Cópiala o márcala con ✅ en cada actualización. Lleva unos **15 minutos tuyos** más lo que tarde Railway en construir (unos 5).

> **Qué pasa por dentro.** Cada `push` a la rama `main` del repositorio de GitHub hace que Railway reconstruya y arranque el servicio `app`. Ese arranque **aplica solo todas las migraciones** (la base central, la de la tienda #1, la plantilla de los negocios nuevos y **todos los negocios**). No corres ningún comando de base de datos en el servidor. Detalle en [RUNBOOK §4, §14 y §19](RUNBOOK.md).

## Datos de esta actualización (rellena)

| | |
| --- | --- |
| Fecha y hora | |
| Qué cambia (en una frase) | |
| Último commit que sube (7 dígitos) | |
| Migraciones nuevas (nombres) | |
| ¿La migración toca datos que ya existen (no solo agrega tablas o columnas)? | sí / no |
| Quién la sube | |

## 0. Antes de empezar (en tu PC)

El repositorio está en `C:\Users\Fabricio Andino\Desktop\Andino Sotfware\Boutique-ventas-saas` y la rama de trabajo es `saas/etapa-0`. Los comandos usan `git -C` para que funcionen desde cualquier carpeta.

- [ ] **No hay cambios sin guardar.** Esto debe salir vacío:

  ```bash
  git -C "C:\Users\Fabricio Andino\Desktop\Andino Sotfware\Boutique-ventas-saas" status --short
  ```

- [ ] **Mira exactamente qué vas a subir** (anota lo que salga en la tabla de arriba):

  ```bash
  git -C "C:\Users\Fabricio Andino\Desktop\Andino Sotfware\Boutique-ventas-saas" fetch origin
  git -C "C:\Users\Fabricio Andino\Desktop\Andino Sotfware\Boutique-ventas-saas" log --oneline origin/main..HEAD
  git -C "C:\Users\Fabricio Andino\Desktop\Andino Sotfware\Boutique-ventas-saas" diff --stat origin/main..HEAD -- prisma/migrations
  ```

  La primera lista son los cambios que se suben; la segunda, las migraciones nuevas (si no sale nada, no hay).

- [ ] **Está verificado.** Lint, tipos, pruebas y E2E en verde. Si no estás seguro, antes de subir pídele a Claude: «verifica todo antes de subir». No subas con algo en rojo.
- [ ] **Hora tranquila.** La app se reinicia y puede haber **1 o 2 minutos sin servicio**. Evita la hora de más ventas.
- [ ] **Respaldo.**
  - Si la migración **solo agrega** (una tabla o columna nueva): basta con que el último respaldo sea de hoy. Míralo en Railway → bucket `respaldos` (el cron corre a las 02:00 de Honduras).
  - Si la migración **toca datos que ya existen**: fuerza un respaldo antes. Railway → servicio `cron-respaldos` → Deployments → **Redeploy** (corre una vez). Mira en sus *Logs* que termine sin errores y que el archivo nuevo aparezca en el bucket. **Las migraciones no se revierten.**
- [ ] Tienes a mano, **fuera de Railway**, `PLATFORM_MASTER_KEY` y `BACKUP_PASSPHRASE` (gestor de contraseñas). Sin ellas, un desastre no se recupera.

## 1. Subir

**Forma corta (un solo comando).** Solo escribes qué cambió; el comando revisa, guarda y sube:

```bash
pnpm --dir "C:\Users\Fabricio Andino\Desktop\Andino Sotfware\Boutique-ventas-saas" subir "qué cambió"
```

También sirve hacer **doble clic en `subir.cmd`** (en la carpeta del repositorio): te pregunta qué cambió, te enseña qué va a subir y te pide un Enter. Dentro de la carpeta basta `pnpm subir "qué cambió"`.

- Antes de subir revisa GitHub y **se niega** si tiene algo que tu rama no tiene (nunca fuerza nada), si hay archivos `.env`, llaves, respaldos o archivos de más de 5 MB, o si falló la verificación.
- Enseña los archivos, el mensaje y **avisa si hay migraciones** (se aplican solas en todos los negocios al desplegar).
- Opciones: `--si` (no pregunta antes de subir) y `--verificar` (antes corre tipos, lint y formato; no sustituye las pruebas).
- Si algo falla, el mensaje dice qué hacer y lo ya guardado no se pierde: al volver a correrlo sube lo que falta.

**A mano** (lo mismo, paso a paso):

```bash
git -C "C:\Users\Fabricio Andino\Desktop\Andino Sotfware\Boutique-ventas-saas" push origin saas/etapa-0:main
```

- Git te pide tu acceso a GitHub (usuario y token o el gestor de credenciales). **No pegues el token en ningún chat.**
- Si dice que fue rechazado (*non-fast-forward* o parecido): **no uses `--force`**. Alguien subió algo antes; avisa y se revisa.
- Debe terminar con una línea como `saas/etapa-0 -> main`.

## 2. Mirar el despliegue (5–10 minutos)

Railway → proyecto **boutique-pos** → servicio **app** → **Deployments** → el más nuevo → **View logs**.

- [ ] El despliegue empieza solo unos segundos después del push. Si no aparece, usa **Deploy latest commit** en ese servicio.
- [ ] En los registros del arranque deben salir, **en este orden**:

  | Evento | Significa |
  | --- | --- |
  | `control_migrate.done` | La base central quedó al día |
  | `billing_sweep.done` | Se anotaron los vencimientos de suscripciones |
  | `migrate.done` | La base de la tienda #1 quedó al día |
  | `template.done` | La plantilla de negocios nuevos quedó al día |
  | `fleet_migrate.done` | **Todos los negocios** quedaron al día |
  | `server.start` con `"photos":"s3"` | La app arrancó y guarda las fotos en el bucket |

- [ ] **Si sale `fleet_migrate.partial`:** algún negocio quedó **«En mantenimiento»** (pantalla de actualización) con el motivo anotado; los demás siguen. Entra al panel → **Negocios**, abre ese negocio y pulsa **Actualizar sus datos**, o mira **Revisión del servidor**. Ver [RUNBOOK §14](RUNBOOK.md).
- [ ] **Si `migrate.start` no pasa a `migrate.done`** y el servicio se reinicia en bucle: la migración falló. La app **no atiende** con la base a medias a propósito. Copia el error de los registros, **no sigas empujando** y pasa a «Si algo sale mal».
- [ ] **Si `server.start` dice `"photos":"file:…"`** en lugar de `"s3"`: faltan las variables `S3_*` de la app. Las fotos nuevas se perderían al actualizar: arréglalo antes de que alguien suba fotos.

## 3. Comprobar que quedó bien (5 minutos)

- [ ] `https://admin.andino-software.cloud/api/health` responde `{"status":"ok"}`.
- [ ] El panel de plataforma abre: `https://admin.andino-software.cloud`.
- [ ] Una tienda abre y deja entrar: `https://giocollecionpos.andino-software.cloud/login`.
- [ ] Panel → **Negocios**: ninguno quedó en mantenimiento.
- [ ] **Planes:** si esta versión trae una función nueva por plan, los planes que ya existen **no la reciben solos**. Panel → **Planes** → abre cada plan → marca la función → guarda. *(Esta versión no agrega funciones por plan; la anterior sumó «Finanzas: gastos, ingresos y utilidad».)*
- [ ] **Prueba lo nuevo en una tienda de verdad** (usa una de prueba, no la de un cliente). Lista de esta versión; cámbiala en cada actualización:
  - [ ] **Vender** → botón **Caja**: el panel muestra el efectivo que debe haber y los botones *Ingresar efectivo*, *Retirar efectivo*, *Agregar gasto*, *Apartados*, *Cancelar venta* y *Realizar corte*.
  - [ ] Abrir caja: si el último cierre dejó efectivo, se ve el **saldo anterior** y **no se puede cambiar**. Si no dejó, se escribe el fondo.
  - [ ] **Cancelar venta** con prendas en el ticket pide un **motivo** y aparece en **Auditoría** como «Venta cancelada antes de cobrar».
  - [ ] **Realizar corte:** se cuentan **billetes y monedas** (el total sale solo), se ve la diferencia, se retira una parte y la siguiente apertura muestra lo que quedó.
  - [ ] **Configuración → Logo del ticket:** subir un logo, verlo, y **cobrar una venta de prueba**: el recibo sale con logo, «Comprobante de venta», fecha, hora, columnas y total en banda negra.
  - [ ] Las pantallas se ven con menos texto: títulos sin subtítulo, ayudas cortas y letra de 14 px o más.
- [ ] Al día siguiente, mira que el cron `tareas-diarias` y el de respaldos no hayan salido en rojo.

## 4. Si algo sale mal

| Qué pasa | Qué hacer |
| --- | --- |
| La migración falla y `app` se reinicia en bucle | Los negocios **no se tocan** (la app no sirve con la base a medias). Copia el error de los registros y avísalo. Mientras tanto Railway conserva el despliegue anterior si todavía está activo; no borres nada. |
| La versión nueva arranca pero tiene un error | Railway → `app` → Deployments → el despliegue **anterior** → **Redeploy**. Vuelve al código viejo. **Las migraciones ya aplicadas se quedan**: son compatibles hacia atrás (agregar antes de quitar), así que la tabla o columna nueva queda sin usarse. |
| Se dañaron datos de un negocio | Restaurar **un** negocio desde su respaldo sin tocar a los demás: [RUNBOOK §16](RUNBOOK.md). |
| Un negocio quedó «En mantenimiento» | Panel → ese negocio → **Actualizar sus datos** (o **Revisión del servidor → Actualizar todos**). |
| Se quedó sin servicio por costo | Railway → Workspace → **Usage**: el tope de $10 apaga los servicios al llegar. Súbelo o espera al siguiente ciclo. |

## Lo que NO se hace

- No usar `git push --force` hacia `main`.
- No pegar contraseñas, tokens, `PLATFORM_MASTER_KEY` ni `BACKUP_PASSPHRASE` en chats ni en el repositorio.
- No fusionar a ciegas las ramas que abre Dependabot (subidas mayores como TypeScript 6 o TanStack Table 9): se prueban primero.
- No borrar el volumen de `postgres` ni los buckets `fotos` y `respaldos`.
- No cambiar variables de Railway «por probar»: cada cambio reinicia el servicio.

## 5. Tu base local (opcional)

Si vas a seguir trabajando en tu PC con la versión nueva, aplica las migraciones a tu base de desarrollo:

```bash
pnpm db:deploy
```

## Registro (anota cada actualización)

| Fecha | Commit | Migraciones | Resultado | Notas |
| --- | --- | --- | --- | --- |
| | | | ✅ / ❌ | |
