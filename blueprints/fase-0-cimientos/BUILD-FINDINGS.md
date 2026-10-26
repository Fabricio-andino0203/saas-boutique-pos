# Hallazgos de la construcción real (2026-10-25)

Defectos del blueprint que solo aparecieron al ejecutarlo en esta máquina (Windows 11, Git Bash, pnpm 12). El bundle **no** se volvió a validar con estos cambios; si se reutiliza para otro proyecto, corrígelos primero.

| # | Dónde | Qué pasó | Solución aplicada en la construcción |
|---|---|---|---|
| 1 | Paso 1 / §20.1 (cobertura) | `grep 'money.ts'` sobre la salida de texto nunca encuentra el archivo: con 100 % Vitest 5 imprime solo "1 file fully covered". | Reporter `["text", "json-summary"]` y gate sobre `coverage/coverage-summary.json` (ya incorporado en el bundle). |
| 2 | Paso 10 | `pnpm dlx shadcn add … --yes` se cuelga si no se pasa `--overwrite` (pregunta por `button.tsx`). | `--overwrite` y restaurar `button.tsx` con `git checkout`. |
| 3 | Paso 10 | El CLI de shadcn añade el paquete externo `cn` y lo importa en los 9 archivos nuevos. | `pnpm remove cn` y `from "@/lib/utils"` (usa `clsx` + `tailwind-merge`). |
| 4 | Paso 10 | `src/hooks/use-mobile.ts` generado rompe `react-hooks/set-state-in-effect`. | Reescrito con `useSyncExternalStore`. |
| 5 | Paso 12 | Con `next dev` abierto, `.next/dev/types` queda obsoleto al mover `page.tsx` y `pnpm build` falla en el tipado. | Borrar `.next/dev/types` (generado, en `.gitignore`). |
| 6 | Pasos 9, 12, 14 | Dos `next dev` en el mismo directorio no conviven: el de la vista previa choca con `smoke-server.ts dev`. | Parar la vista previa mientras se verifica. |
| 7 | Paso 14 (`/dev/componentes=404`) | Git Bash en Windows convierte el argumento en `C:/Program Files/Git/dev/componentes`. | `MSYS_NO_PATHCONV=1` al ejecutar los gates. El valor da igual: basta con que exista, y se quita con `env -u` para los scripts propios. |
| 8 | Paso 14 (galería) | El `h2` de la sección de `MoneyInput` y su `label` se llamaban igual ("Monto"): `getByLabel` resolvía 2 elementos. | Clave nueva `messages.dev.gallery.money.title` ("Campo de dinero"). |
| 9 | Paso 13 | `useReactTable` dispara `react-hooks/incompatible-library` y `eslint --max-warnings 0` falla. | La línea `eslint-disable-next-line` justificada que el propio paso prevé. |
| 10 | Paso 1 | La máquina no tenía identidad de git. | Configurada solo en el repo (`user.name` y `user.email` locales). |
| 11 | Repo (commit `6ea1527`) | `pnpm install --frozen-lockfile` abortaba con `ERR_PNPM_IGNORED_BUILDS` en un clon limpio. | Decisiones `allowBuilds` para `prisma`, `@prisma/engines` y `esbuild`. |
