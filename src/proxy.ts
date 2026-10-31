import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/session-cookie";
import { getTenantDirectory } from "@/lib/tenancy/directory";

/** Rutas que no necesitan sesión (la entrada y el estado del servicio). */
function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/") || pathname === "/api/health";
}

/**
 * Primera barrera, en dos pasos:
 * 1. Modo multi-negocio: un host que no está en el directorio no existe. Se comprueba en **todas** las rutas (también en
 *    `/login`) antes de leer cookies o tocar datos; solo el estado del servicio (`/api/health`) es de la plataforma.
 * 2. Sin cookie de sesión se redirige a /login. No es seguridad por sí sola: la validación real de la sesión y de los
 *    permisos ocurre en el servidor (`requireSession`).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (
    process.env.TENANCY_MODE === "multi" &&
    pathname !== "/api/health" &&
    !getTenantDirectory().lookupByHost(request.headers.get("host") ?? "")
  ) {
    return new NextResponse("Negocio no encontrado", { status: 404 });
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
