/**
 * Cabeceras de seguridad de toda respuesta. El HSTS solo se manda fuera de desarrollo: sobre HTTP los navegadores lo ignoran, y
 * donde no hay Caddy que lo agregue (Railway) tiene que venir de la propia aplicación. Con Caddy delante el valor es el mismo y
 * Caddy lo reemplaza, no se duplica.
 *
 * La CSP permite scripts y estilos en línea porque Next inyecta los suyos (la carga de datos de React y los estilos de
 * las páginas). Una CSP con *nonce* los evitaría, pero obliga a renderizar cada página en cada petición y se pierde el
 * caché de Cache Components; queda anotado como mejora futura en `docs/ARCHITECTURE.md` §11.
 */

export type SecurityHeader = { key: string; value: string };

export function contentSecurityPolicy(isDevelopment: boolean): string {
  return [
    "default-src 'self'",
    // En desarrollo Next usa eval para el recarga en caliente.
    `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDevelopment ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders(isDevelopment: boolean): SecurityHeader[] {
  return [
    ...(isDevelopment
      ? []
      : [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ]),
    { key: "Content-Security-Policy", value: contentSecurityPolicy(isDevelopment) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}
