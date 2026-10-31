/**
 * Cookie de sesión del panel de la plataforma. Es **otra** cookie que la de las tiendas (otro nombre, otro host): un token de
 * una tienda no abre el panel y al revés. Sin atributo Domain, así que el navegador no la manda a ningún otro subdominio.
 *
 * En producción lleva el prefijo `__Host-` (el navegador exige entonces Secure, Path=/ y ningún Domain); en local, que va
 * por http, no se puede usar ese prefijo. Solo lee el entorno: también la usa el `proxy`.
 */
export function platformCookieSecure(): boolean {
  return process.env.DEPLOYMENT === "production";
}

export function platformCookieName(): string {
  return platformCookieSecure() ? "__Host-boutique_platform" : "boutique_platform";
}

/** Rutas del panel que se pueden ver sin sesión completa (la entrada y el estado del servicio). */
export function isPlatformPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/") || pathname === "/api/health";
}
