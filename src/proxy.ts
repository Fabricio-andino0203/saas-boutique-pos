import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import { isPlatformPublicPath, platformCookieName } from "@/lib/platform-cookie";
import { sessionCookieName } from "@/lib/session-cookie";
import { getTenantDirectory } from "@/lib/tenancy/control-directory";
import { classifyHost, type HostKind } from "@/lib/tenancy/host";
import { unavailableResponse } from "@/lib/tenancy/unavailable-page";

/** Rutas de un negocio que no necesitan sesión (la entrada y el estado del servicio). */
function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/") || pathname === "/api/health";
}

/** Dentro de la aplicación el panel de la plataforma vive bajo `/platform`; solo se llega a él por su host. */
const PLATFORM_PREFIX = "/platform";

/**
 * Pregunta de Caddy ("¿emito certificado para este dominio?"). Llega directo de Caddy, con el host interno `app:3000`: no
 * es de ningún negocio, así que se deja pasar antes de clasificar el host. La ruta se defiende sola (ver su archivo).
 */
const TLS_ASK_PATH = "/api/internal/tls-allowed";

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
 *    (rutas, parámetros, cuerpo, cookies) puede elegir el negocio ni entrar al panel de la plataforma. En modo
 *    multi-negocio el host se busca en la base central (con una caché corta); si el directorio no responde y no hay una
 *    respuesta reciente que reutilizar, se contesta 503 en vez de adivinar.
 * 2. Host de la plataforma → panel del superadministrador. Host desconocido (modo multi-negocio) → 404 en **todas** las
 *    rutas, también en `/login`, antes de leer cookies o tocar datos; solo el estado del servicio es de la plataforma.
 *    Host de un negocio suspendido → pantalla de cuenta suspendida, sin tocar su base.
 * 3. Host de un negocio: no puede abrir `/platform`; sin cookie de sesión se redirige a /login. No es seguridad por sí
 *    sola: la validación real de la sesión y de los permisos ocurre en el servidor (`requireSession`).
 */
export async function proxy(request: NextRequest): Promise<Response> {
  const { pathname, search } = request.nextUrl;
  if (pathname === TLS_ASK_PATH) {
    return NextResponse.next();
  }

  let kind: HostKind;
  try {
    kind = await classifyHost(request.headers.get("host"), {
      mode: process.env.TENANCY_MODE === "multi" ? "multi" : "single",
      platformHost: process.env.PLATFORM_HOST,
      directory: getTenantDirectory(),
    });
  } catch (error) {
    logger.error("tenant.directory_unavailable", { error });
    return unavailableResponse("directory-down");
  }

  if (kind === "platform") {
    return platformRequest(request);
  }
  if (kind === "suspended" && pathname !== "/api/health") {
    return unavailableResponse("suspended");
  }
  if (kind === "unknown" && pathname !== "/api/health") {
    return notFound("Negocio no encontrado");
  }
  if (isPlatformPath(pathname)) {
    return notFound("No encontrado");
  }
  if (isPublicPath(pathname) || request.cookies.has(sessionCookieName())) {
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
