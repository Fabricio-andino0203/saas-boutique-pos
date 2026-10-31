import { z } from "zod";

/**
 * Variables de entorno validadas al arrancar. Si falta o es inválida alguna,
 * la app falla de inmediato con un mensaje claro en lugar de fallar más tarde.
 * Importar `env` solo desde código de servidor.
 */
/** Textos de ejemplo que nunca deben llegar a una instalación real (los de `.env.example` y de CI). */
const PLACEHOLDER_PATTERN = /replace-with|change-me|ci-only|ci-password|example/i;

/** Un nombre de host con puerto opcional: `admin.tuplataforma.com` o `admin.localhost:3000`. */
const PLATFORM_HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

/** Variable opcional: vacía o ausente es lo mismo (un `.env` con `NOMBRE=` no cuenta como configurada). */
function optionalText() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined));
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /**
     * `production` activa las comprobaciones estrictas de una instalación real (HTTPS, secretos propios). Es independiente
     * de `NODE_ENV`: `next build` y las pruebas E2E también corren con `NODE_ENV=production` y con valores locales.
     */
    DEPLOYMENT: z.enum(["local", "production"]).default("local"),
    DATABASE_URL: z
      .string()
      .min(1)
      .refine((v) => v.startsWith("postgresql://") || v.startsWith("postgres://"), {
        message: "DATABASE_URL debe ser una URL de PostgreSQL",
      }),
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET debe tener al menos 32 caracteres"),
    APP_URL: z.url(),
    TZ: z.string().default("America/Tegucigalpa"),
    /** Intentos fallidos de inicio de sesión por IP cada 15 minutos antes de bloquear (el E2E lo sube porque comparte IP). */
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),

    // ── Plataforma SaaS (docs/SAAS_PROPUESTA.md) ──
    /** `single` = una sola tienda con `DATABASE_URL` (hoy). `multi` = una base por negocio (aún solo prueba, ver Etapa 2). */
    TENANCY_MODE: z.enum(["single", "multi"]).default("single"),
    /** Nombre de host del panel del superadministrador (p. ej. `admin.tuplataforma.com`). Sin él, el panel no existe. */
    PLATFORM_HOST: optionalText(),
    /** Base central de la plataforma (negocios, superadministradores, auditoría). Obligatoria si hay `PLATFORM_HOST`. */
    CONTROL_DATABASE_URL: optionalText(),
    /** Llave que cifra los secretos de la plataforma (32 bytes en base64). Se genera con `pnpm platform:gen-key`. */
    PLATFORM_MASTER_KEY: optionalText(),
    PLATFORM_MASTER_KEY_VERSION: z.coerce.number().int().min(1).default(1),
    /** Solo mientras se rota la llave: la anterior, para seguir descifrando hasta re-cifrar todo. */
    PLATFORM_MASTER_KEY_PREVIOUS: optionalText(),
    PLATFORM_MASTER_KEY_PREVIOUS_VERSION: z.coerce.number().int().min(1).optional(),
    /** Intentos fallidos de entrada al panel de la plataforma por IP cada 15 minutos (más estricto que el de una tienda). */
    PLATFORM_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  })
  .superRefine((value, context) => {
    const problem = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });

    if (value.PLATFORM_HOST) {
      if (!PLATFORM_HOST_PATTERN.test(value.PLATFORM_HOST)) {
        problem(
          "PLATFORM_HOST",
          "PLATFORM_HOST debe ser solo un nombre de host (sin https:// ni rutas)",
        );
      }
      if (!value.CONTROL_DATABASE_URL || !/^postgres(ql)?:\/\//.test(value.CONTROL_DATABASE_URL)) {
        problem(
          "CONTROL_DATABASE_URL",
          "CONTROL_DATABASE_URL es obligatoria cuando hay PLATFORM_HOST",
        );
      }
      if (!value.PLATFORM_MASTER_KEY) {
        problem(
          "PLATFORM_MASTER_KEY",
          "PLATFORM_MASTER_KEY es obligatoria cuando hay PLATFORM_HOST",
        );
      }
    }
    for (const name of ["PLATFORM_MASTER_KEY", "PLATFORM_MASTER_KEY_PREVIOUS"] as const) {
      const key = value[name];
      if (key && Buffer.from(key, "base64").length !== 32) {
        problem(name, `${name} debe ser una llave de 32 bytes en base64 (pnpm platform:gen-key)`);
      }
    }

    if (value.DEPLOYMENT !== "production") {
      return;
    }
    if (value.TENANCY_MODE === "multi") {
      problem("TENANCY_MODE", "El modo multi-negocio aún no está habilitado en producción");
    }
    if (value.PLATFORM_HOST && /^(localhost|127\.|.*\.localhost)/.test(value.PLATFORM_HOST)) {
      problem("PLATFORM_HOST", "PLATFORM_HOST no puede ser un host local en producción");
    }
    if (value.PLATFORM_MASTER_KEY && PLACEHOLDER_PATTERN.test(value.PLATFORM_MASTER_KEY)) {
      problem(
        "PLATFORM_MASTER_KEY",
        "PLATFORM_MASTER_KEY es un texto de ejemplo: genera una propia",
      );
    }
    if (value.CONTROL_DATABASE_URL && PLACEHOLDER_PATTERN.test(value.CONTROL_DATABASE_URL)) {
      problem(
        "CONTROL_DATABASE_URL",
        "CONTROL_DATABASE_URL tiene la contraseña de ejemplo: usa una propia",
      );
    }
    if (value.NODE_ENV !== "production") {
      problem("NODE_ENV", "NODE_ENV debe ser production cuando DEPLOYMENT=production");
    }
    if (!value.APP_URL.startsWith("https://")) {
      problem(
        "APP_URL",
        "APP_URL debe usar https:// en producción (la cookie de sesión es segura)",
      );
    }
    if (PLACEHOLDER_PATTERN.test(value.AUTH_SECRET)) {
      problem("AUTH_SECRET", "AUTH_SECRET es un texto de ejemplo: genera uno propio");
    }
    if (PLACEHOLDER_PATTERN.test(value.DATABASE_URL)) {
      problem("DATABASE_URL", "DATABASE_URL tiene la contraseña de ejemplo: usa una propia");
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Variables de entorno inválidas:\n${details}`);
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
