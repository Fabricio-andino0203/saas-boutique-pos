import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Contraseñas de un solo uso basadas en el tiempo (TOTP, RFC 6238) con HMAC-SHA1, 6 dígitos y pasos de 30 segundos: lo que
 * entienden Google Authenticator, Microsoft Authenticator, Authy, 1Password, etc. Solo usa `node:crypto`.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Pasos que se toleran antes y después del actual por la diferencia de reloj entre el servidor y el teléfono. */
export const TOTP_WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/** Acepta mayúsculas o minúsculas, espacios y guiones (como los escribe una persona); lanza si hay otros caracteres. */
export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error("Invalid base32 character");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secreto nuevo de 160 bits (el tamaño recomendado por el RFC 4226) en base32, listo para el teléfono. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);
}

/** El código de 6 dígitos de un secreto en un intervalo dado (RFC 4226 §5.3 sobre el contador del intervalo). */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    (((digest[offset + 1] as number) & 0xff) << 16) |
    (((digest[offset + 2] as number) & 0xff) << 8) |
    ((digest[offset + 3] as number) & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export type TotpVerification = { ok: true; step: number } | { ok: false };

/**
 * Comprueba un código escrito por una persona. Si `lastAcceptedStep` viene, no acepta ese intervalo ni anteriores: un código
 * ya usado (o espiado por encima del hombro) no sirve una segunda vez. Compara en tiempo constante.
 */
export function verifyTotp(
  secret: string,
  input: string,
  now: Date,
  lastAcceptedStep?: number | null,
): TotpVerification {
  const code = input.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) {
    return { ok: false };
  }
  const current = totpStep(now);
  let accepted: number | undefined;
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step += 1) {
    if (lastAcceptedStep != null && step <= lastAcceptedStep) {
      continue;
    }
    const expected = Buffer.from(totpCode(secret, step));
    const given = Buffer.from(code);
    // Se recorren todos los intervalos sin cortar en el primero que coincide, para no filtrar cuál fue por el tiempo.
    if (timingSafeEqual(expected, given) && accepted === undefined) {
      accepted = step;
    }
  }
  return accepted === undefined ? { ok: false } : { ok: true, step: accepted };
}

/** URI que leen las aplicaciones de autenticación (la que también se dibuja como QR). */
export function otpauthUri(input: { secret: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** El secreto en grupos de 4 letras, más fácil de teclear a mano en el teléfono. */
export function formatSecretForHumans(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}
