/**
 * Nombre de la cookie de sesión de una tienda. Sin atributo Domain: el navegador la manda solo al host que la creó.
 *
 * Con varios negocios en producción lleva el prefijo `__Host-`: el navegador entonces rechaza cualquier versión con Domain,
 * así que una página de otro subdominio de la plataforma (p. ej. una con una falla de seguridad) no puede plantar una cookie
 * de sesión que se mande a todos los negocios. Una sola tienda conserva el nombre de siempre (no se cierran sesiones al
 * actualizar). Solo lee el entorno: también la usa el `proxy`.
 */
export function sessionCookieName(): string {
  return process.env.DEPLOYMENT === "production" && process.env.TENANCY_MODE === "multi"
    ? "__Host-boutique_session"
    : "boutique_session";
}

/** Solo rutas internas: evita que `?next=` redirija a otro sitio tras iniciar sesión. */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string") {
    return "/";
  }
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}
