import { createHash, randomBytes } from "node:crypto";

/** Token que viaja en la cookie. Nunca se guarda tal cual en la base de datos. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Lo que sí se guarda: un hash, para que una fuga de la base no exponga sesiones activas. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
