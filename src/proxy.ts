import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * Primera barrera: sin cookie de sesión se redirige a /login. No es seguridad por sí sola:
 * la validación real de la sesión y de los permisos ocurre en el servidor (`requireSession`).
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }
  const url = new URL("/login", request.url);
  const { pathname, search } = request.nextUrl;
  if (pathname !== "/") {
    url.searchParams.set("next", `${pathname}${search}`);
  }
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/health|_next/static|_next/image|favicon.ico).*)"],
};
