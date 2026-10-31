import { NextResponse, type NextRequest } from "next/server";

import { isPlatformPublicPath, platformCookieName } from "@/lib/platform-cookie";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { getTenantDirectory } from "@/lib/tenancy/directory";
import { classifyHost } from "@/lib/tenancy/host";

/** Rutas de un negocio que no necesitan sesión (la entrada y el estado del servicio). */
function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/") || pathname === "/api/health";
}

/** Dentro de la aplicación el panel de la plataforma vive bajo `/platform`; solo se llega a él por su host. */
const PLATFORM_PREFIX = "/platform";

function isPlatformPath(pathname: string): boolean {
  return pathname === PLATFORM_PREFIX || pathname.startsWith(`${PLATFORM_PREFIX}/`);
}

function notFound(message: string): NextResponse {
  return new NextResponse(message, { status: 404 });
}

/** Panel del superadministrador (`PLATFORM_HOST`): se reescribe a `/platform/...` y sin cookie solo se ve la entrada. */
function platformRequest(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (isPlatformPath(pathname)) {
    return notFound("No encontrado"); // la ruta interna no es una dirección pública
  }
  if (!isPlatformPublicPath(pathname) && !request.cookies.has(platformCookieName())) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const target = new URL(request.url);
  target.pathname = pathname === "/" ? PLATFORM_PREFIX : `${PLATFORM_PREFIX}${pathname}`;
  target.search = search;
  return NextResponse.rewrite(target);
}

/**
 * Primera barrera, en tres pasos:
 * 1. Se clasifica el host (propuesta SaaS §3.3). Es lo único que decide a quién se atiende: nada que mande el navegador
 *    (rutas, parámetros, cookies) puede elegir el negocio ni entrar al panel de la plataforma.
 * 2. Host de la plataforma → panel del superadministrador. Host desconocido (modo multi-negocio) → 404 en **todas** las
 *    rutas, también en `/login`, antes de leer cookies o tocar datos; solo el estado del servicio es de la plataforma.
 * 3. Host de un negocio: no puede abrir `/platform`; sin cookie de sesión se redirige a /login. No es seguridad por sí
 *    sola: la validación real de la sesión y de los permisos ocurre en el servidor (`requireSession`).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = request.headers.get("host");
  const kind = classifyHost(host, {
    mode: process.env.TENANCY_MODE === "multi" ? "multi" : "single",
    platformHost: process.env.PLATFORM_HOST,
    directory: getTenantDirectory(),
  });

  if (kind === "platform") {
    return platformRequest(request);
  }
  if (kind === "unknown" && pathname !== "/api/health") {
    return notFound("Negocio no encontrado");
  }
  if (isPlatformPath(pathname)) {
    return notFound("No encontrado");
  }
  if (isPublicPath(pathname) || request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }
  const url = new URL("/login", request.url);
  if (pathname !== "/") {
    url.searchParams.set("next", `${pathname}${search}`);
  }
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
