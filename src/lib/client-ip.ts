/**
 * La IP del cliente según el proxy de adelante (Caddy escribe `X-Forwarded-For` con la dirección real y descarta lo que
 * mande el navegador). Solo sirve para registrar y limitar intentos, nunca para decidir permisos. Si el valor no parece
 * una dirección se ignora: así nadie puede llenar el registro ni los contadores con texto arbitrario.
 */
const IP_SHAPE = /^[0-9a-fA-F:.]{2,45}$/;

export function clientIpFrom(headers: Pick<Headers, "get">): string | undefined {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || headers.get("x-real-ip")?.trim();
  return candidate && IP_SHAPE.test(candidate) ? candidate : undefined;
}
