import { env } from "@/lib/env";

/**
 * La IP del cliente según el proxy de adelante. Solo sirve para registrar y limitar intentos, nunca para decidir permisos. Si
 * el valor no parece una dirección se ignora: así nadie puede llenar el registro ni los contadores con texto arbitrario.
 *
 * Qué cabecera creer depende de quién esté delante (`CLIENT_IP_HEADER`):
 * - `x-forwarded-for` (por omisión): Caddy la escribe con la dirección real y descarta lo que mande el navegador; se toma la
 *   primera dirección, y si falta, `X-Real-IP`.
 * - `x-real-ip`: el borde de Railway la escribe con la dirección real y descarta lo que mande el navegador. Aquí **no** se mira
 *   `X-Forwarded-For`, que un cliente puede inventar y que ese borde no garantiza limpiar.
 */
const IP_SHAPE = /^[0-9a-fA-F:.]{2,45}$/;

export function clientIpFrom(
  headers: Pick<Headers, "get">,
  trusted: "x-forwarded-for" | "x-real-ip" = env.CLIENT_IP_HEADER,
): string | undefined {
  const real = headers.get("x-real-ip")?.trim();
  const candidate =
    trusted === "x-real-ip" ? real : headers.get("x-forwarded-for")?.split(",")[0]?.trim() || real;
  return candidate && IP_SHAPE.test(candidate) ? candidate : undefined;
}
