import { z } from "zod";

/**
 * Variables de entorno validadas al arrancar. Si falta o es inválida alguna,
 * la app falla de inmediato con un mensaje claro en lugar de fallar más tarde.
 * Importar `env` solo desde código de servidor.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((v) => v.startsWith("postgresql://") || v.startsWith("postgres://"), {
      message: "DATABASE_URL debe ser una URL de PostgreSQL",
    }),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET debe tener al menos 32 caracteres"),
  APP_URL: z.url(),
  TZ: z.string().default("America/Tegucigalpa"),
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
