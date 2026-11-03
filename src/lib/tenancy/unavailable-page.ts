/**
 * Pantallas que el proxy devuelve cuando una dirección no puede atender: HTML fijo y sin datos del negocio (nada que
 * interpolar, nada que escapar). Se responden **antes** de leer cookies o tocar una base.
 */

import { platformMessages } from "@/config/messages.platform.es";

export type UnavailableKind =
  "suspended" | "expired" | "feature" | "maintenance" | "directory-down";

const COPY: Record<
  UnavailableKind,
  { status: number; title: string; body: string; back?: string }
> = {
  suspended: { status: 403, ...platformMessages.unavailable.suspended },
  expired: { status: 403, ...platformMessages.unavailable.expired },
  feature: { status: 403, ...platformMessages.unavailable.feature },
  maintenance: { status: 503, ...platformMessages.unavailable.maintenance },
  "directory-down": { status: 503, ...platformMessages.unavailable.directoryDown },
};

export function unavailableResponse(kind: UnavailableKind): Response {
  const { status, title, body, back } = COPY[kind];
  const html = `<!doctype html>
<html lang="es-HN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #fff9fb; color: #2d2d2d; }
  main { max-width: 28rem; margin: 1rem; padding: 2rem; background: #fff; border: 1px solid #f3dde5; border-top: 4px solid #f43f78; border-radius: 0.75rem; }
  h1 { margin: 0 0 0.75rem; font-size: 1.25rem; color: #5b1e3d; }
  p { margin: 0; line-height: 1.5; color: #5d4450; }
  a { color: #d6275f; }
  @media (prefers-color-scheme: dark) {
    body { background: #170e14; color: #f8eaf0; }
    main { background: #22141d; border-color: #33202b; border-top-color: #f43f78; }
    h1 { color: #fbc3d2; }
    p { color: #c9a8b8; }
    a { color: #ff6b96; }
  }
</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p>${body}</p>
${back ? `<p style="margin-top:1rem"><a href="/">${back}</a></p>` : ""}
</main>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...(status === 503 ? { "retry-after": kind === "maintenance" ? "300" : "30" } : {}),
    },
  });
}
