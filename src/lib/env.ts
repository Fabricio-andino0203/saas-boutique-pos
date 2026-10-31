import { z } from "zod";

/**
 * Variables de entorno validadas al arrancar. Si falta o es inválida alguna,
 * la app falla de inmediato con un mensaje claro en lugar de fallar más tarde.
 * Importar `env` solo desde código de servidor.
 */
/** Textos de ejemplo que nunca deben llegar a una instalación real (los de `.env.example` y de CI). */
const PLACEHOLDER_PATTERN = /replace-with|change-me|ci-only|ci-password|example/i;

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
  })
  .superRefine((value, context) => {
    if (value.DEPLOYMENT !== "production") {
      return;
    }
    const problem = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });
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
