/**
 * Subdominio de un negocio (`tienda-a` → tienda-a.<dominio base>). El formato es el mismo que fuerza la base central
 * (restricción `Tenant_slug_format`): minúsculas, números y guiones, sin empezar ni terminar en guion, hasta 40 caracteres.
 */
export const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * Subdominios que nunca pueden ser de un negocio: los usa la plataforma o se prestan a confundir a las personas
 * (`admin`, `soporte`…) o a engañar con direcciones de aspecto oficial. El host del panel se resuelve antes que cualquier
 * negocio, así que `admin` jamás llegaría a un negocio; aun así se reserva para que ninguna tienda pueda pedirlo.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "administrador",
  "api",
  "app",
  "billing",
  "cdn",
  "ftp",
  "health",
  "login",
  "mail",
  "panel",
  "pagos",
  "platform",
  "plataforma",
  "root",
  "smtp",
  "soporte",
  "static",
  "status",
  "support",
  "www",
]);

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

export function isReservedSlug(value: string): boolean {
  return RESERVED_SLUGS.has(value);
}

/**
 * El subdominio de un host dentro del dominio base: `tienda-a.localhost` con base `localhost` → `tienda-a`.
 * Devuelve `undefined` si el host no es exactamente `<slug>.<base>` (un solo nivel), si el slug no tiene el formato válido o
 * si está reservado. Así un nombre de host cualquiera nunca provoca una consulta a la base central.
 */
export function slugFromHost(host: string | undefined, baseDomain: string): string | undefined {
  if (!host || !baseDomain) {
    return undefined;
  }
  const suffix = `.${baseDomain.toLowerCase()}`;
  if (!host.endsWith(suffix)) {
    return undefined;
  }
  const slug = host.slice(0, -suffix.length);
  return isValidSlug(slug) && !isReservedSlug(slug) ? slug : undefined;
}
