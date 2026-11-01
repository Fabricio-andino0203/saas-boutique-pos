/**
 * Registro estructurado: una línea de JSON por evento, a la salida estándar (info y debug) o de errores (warn y error),
 * para que Docker y cualquier recolector de logs lo lean sin configurar nada.
 *
 * Nunca registra secretos: cualquier campo cuyo nombre parezca una contraseña, PIN, token, cookie o hash se reemplaza por
 * `[REDACTED]`, sin importar a qué profundidad venga. Es código solo de servidor (usa `process`).
 */

import { tenantFromContext } from "@/lib/tenancy/tenant-context";

type Level = "debug" | "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

const LEVEL_RANK: Record<Level | "silent", number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const SECRET_KEY =
  /pass(word|wd)?|\bpin\b|pin(hash)?$|token|secret|authorization|cookie|hash|credential/i;
const MAX_DEPTH = 5;
const MAX_STRING = 2_000;

function threshold(): number {
  const configured = process.env.LOG_LEVEL?.toLowerCase() as Level | "silent" | undefined;
  return LEVEL_RANK[configured ?? "info"] ?? LEVEL_RANK.info;
}

function serializeError(error: Error): LogFields {
  const extra = error as Error & { code?: unknown; digest?: unknown; status?: unknown };
  return {
    name: error.name,
    message: error.message.slice(0, MAX_STRING),
    code: extra.code,
    digest: extra.digest,
    status: extra.status,
    stack: process.env.NODE_ENV === "production" ? undefined : error.stack?.slice(0, MAX_STRING),
  };
}

/** Copia el valor sin secretos y con tamaño acotado (un log no debe poder crecer sin límite). */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return sanitize(serializeError(value), depth + 1);
  }
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (depth >= MAX_DEPTH) {
    return "[…]";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  }
  const result: LogFields = {};
  for (const [key, inner] of Object.entries(value)) {
    if (inner === undefined) {
      continue;
    }
    result[key] = SECRET_KEY.test(key) ? "[REDACTED]" : sanitize(inner, depth + 1);
  }
  return result;
}

export function formatLogLine(level: Level, event: string, fields: LogFields = {}): string {
  // Multi-negocio: el trabajo que corre "como" un negocio (`runWithTenant`: tareas y scripts) lo deja en cada línea. En una
  // petición web el negocio sale del host (se resuelve de forma asíncrona), así que ahí quien registra pasa `tenant` a mano.
  const tenant = tenantFromContext();
  return JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    ...(tenant ? { tenant: tenant.slug ?? tenant.id } : {}),
    ...(sanitize(fields) as LogFields),
  });
}

function write(level: Level, event: string, fields?: LogFields): void {
  if (LEVEL_RANK[level] < threshold()) {
    return;
  }
  const line = formatLogLine(level, event, fields);
  if (level === "warn" || level === "error") {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

export const logger = {
  debug: (event: string, fields?: LogFields) => write("debug", event, fields),
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
