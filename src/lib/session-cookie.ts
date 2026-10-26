export const SESSION_COOKIE = "boutique_session";

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
