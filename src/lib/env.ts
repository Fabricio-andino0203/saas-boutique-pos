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

/** Número opcional con la misma regla: `NOMBRE=` (vacío) cuenta como no configurado en vez de ser un 0 inválido. */
function optionalInt(min: number, max: number) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce.number().int().min(min).max(max).optional(),
  );
}

/** Un nombre de host sin puerto: `tuplataforma.com`, `localhost` o una IP. */
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;
/** Hosts que solo existen en el equipo de quien desarrolla. */
const LOCAL_HOST_PATTERN = /^(localhost|127\.|\[?::1\]?|.*\.localhost)(:\d+)?$/i;

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
    /**
     * Carpeta donde se guardan las fotos de los productos (una subcarpeta por negocio). En una instalación real debe ser un
     * volumen que sobreviva a las actualizaciones (docs/RUNBOOK.md §18). Vacío = `.data/uploads` junto al proyecto (desarrollo).
     */
    UPLOADS_DIR: optionalText(),
    /**
     * Alternativa a la carpeta: las fotos en un servicio de objetos compatible con S3 (el Bucket de Railway, R2, S3…). Con
     * `S3_BUCKET` puesto se usa este y no la carpeta. `S3_ENDPOINT` vacío = el de AWS; `S3_REGION` vacío = `auto`.
     */
    S3_BUCKET: optionalText(),
    S3_ENDPOINT: optionalText(),
    S3_REGION: optionalText(),
    S3_ACCESS_KEY_ID: optionalText(),
    S3_SECRET_ACCESS_KEY: optionalText(),
    /** `true` si el servicio pide el nombre del bucket en la ruta y no en el nombre del servidor (los antiguos). */
    S3_FORCE_PATH_STYLE: optionalText(),
    /**
     * De qué cabecera sale la IP del cliente: `x-forwarded-for` (Caddy, el de siempre) o `x-real-ip` (Railway, cuyo borde la
     * escribe con la IP real). Solo se usa para registrar y limitar intentos.
     */
    CLIENT_IP_HEADER: z.enum(["x-forwarded-for", "x-real-ip"]).default("x-forwarded-for"),
    /** `off` apaga la pregunta de certificados de Caddy (`/api/internal/tls-allowed`): donde no hay Caddy, ni existe. */
    TLS_ASK: z.enum(["on", "off"]).default("on"),

    // ── Plataforma SaaS (docs/SAAS_PROPUESTA.md) ──
    /** `single` = una sola tienda con `DATABASE_URL` (hoy). `multi` = una base por negocio, cada uno en su subdominio. */
    TENANCY_MODE: z.enum(["single", "multi"]).default("single"),
    /** Nombre de host del panel del superadministrador (p. ej. `admin.tuplataforma.com`). Sin él, el panel no existe. */
    PLATFORM_HOST: optionalText(),
    /** Dominio bajo el que viven los negocios (`tuplataforma.com` → `tienda-a.tuplataforma.com`). Obligatorio en `multi`. */
    TENANT_BASE_DOMAIN: optionalText(),
    /**
     * Cuenta de Postgres que puede crear roles y bases (el alta de negocios) y migrarlas. Sin ella el panel no da de alta
     * negocios nuevos. La aplicación en funcionamiento no la usa para atender: cada negocio se conecta con su rol limitado.
     */
    TENANT_PROVISIONING_URL: optionalText(),
    /** Base «dorada» desde la que se copia cada negocio nuevo (se mantiene al día en cada arranque). */
    TENANT_TEMPLATE_DB: optionalText(),
    /** Servidor donde están las bases de los negocios; por omisión, el de la base central. */
    TENANT_DB_HOST: optionalText(),
    TENANT_DB_PORT: optionalInt(1, 65535),
    /** Cuánto se recuerda qué negocio es cada host (milisegundos). Es lo que tarda en notarse una suspensión; 0 = sin caché. */
    TENANT_DIRECTORY_TTL_MS: optionalInt(0, 600_000),
    /**
     * Conexiones de esta instancia hacia las bases de los negocios (Etapa 6, docs/RUNBOOK.md §17). `MAX_CONNECTIONS` es el
     * presupuesto total (60 deja lugar en un Postgres de fábrica con 100); `SIZE`, las conexiones de cada negocio abierto;
     * `MAX_ACTIVE`, el tope de negocios abiertos por memoria. Vacío = valores de fábrica.
     */
    TENANT_POOL_MAX_CONNECTIONS: optionalInt(2, 20_000),
    TENANT_POOL_SIZE: optionalInt(1, 20),
    TENANT_POOL_MAX_ACTIVE: optionalInt(1, 5_000),
    /** Base central de la plataforma (negocios, superadministradores, auditoría). Obligatoria en `multi`. */
    CONTROL_DATABASE_URL: optionalText(),
    /** Llave que cifra los secretos de la plataforma (32 bytes en base64). Se genera con `pnpm platform:gen-key`. */
    PLATFORM_MASTER_KEY: optionalText(),
    PLATFORM_MASTER_KEY_VERSION: z.coerce.number().int().min(1).default(1),
    /** Solo mientras se rota la llave: la anterior, para seguir descifrando hasta re-cifrar todo. */
    PLATFORM_MASTER_KEY_PREVIOUS: optionalText(),
    PLATFORM_MASTER_KEY_PREVIOUS_VERSION: optionalInt(1, 1_000_000),
    /** Intentos fallidos de entrada al panel de la plataforma por IP cada 15 minutos (más estricto que el de una tienda). */
    PLATFORM_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  })
  .superRefine((value, context) => {
    const problem = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });

    if (value.PLATFORM_HOST) {
      if (value.TENANCY_MODE !== "multi") {
        problem(
          "PLATFORM_HOST",
          "PLATFORM_HOST solo se admite con TENANCY_MODE=multi (ver src/lib/tenancy/host.ts)",
        );
      }
      if (!PLATFORM_HOST_PATTERN.test(value.PLATFORM_HOST)) {
        problem(
          "PLATFORM_HOST",
          "PLATFORM_HOST debe ser solo un nombre de host (sin https:// ni rutas)",
        );
      }
    }
    if (value.TENANCY_MODE === "multi") {
      // Cada negocio es un subdominio del dominio base y su base se descifra con la llave maestra: sin estas tres piezas el
      // modo multi-negocio no puede decir de quién es una petición, y es mejor no arrancar.
      if (!value.CONTROL_DATABASE_URL || !/^postgres(ql)?:\/\//.test(value.CONTROL_DATABASE_URL)) {
        problem(
          "CONTROL_DATABASE_URL",
          "CONTROL_DATABASE_URL es obligatoria con TENANCY_MODE=multi",
        );
      }
      if (!value.PLATFORM_MASTER_KEY) {
        problem("PLATFORM_MASTER_KEY", "PLATFORM_MASTER_KEY es obligatoria con TENANCY_MODE=multi");
      }
      if (!value.TENANT_BASE_DOMAIN) {
        problem(
          "TENANT_BASE_DOMAIN",
          "TENANT_BASE_DOMAIN es obligatorio con TENANCY_MODE=multi (p. ej. tuplataforma.com)",
        );
      }
    }
    if (
      value.TENANT_POOL_MAX_CONNECTIONS !== undefined &&
      value.TENANT_POOL_MAX_CONNECTIONS < (value.TENANT_POOL_SIZE ?? 2)
    ) {
      problem(
        "TENANT_POOL_MAX_CONNECTIONS",
        "TENANT_POOL_MAX_CONNECTIONS no puede ser menor que las conexiones de un negocio (TENANT_POOL_SIZE)",
      );
    }
    const s3Fields = [
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_FORCE_PATH_STYLE",
    ] as const;
    if (value.S3_BUCKET) {
      for (const name of ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
        if (!value[name]) {
          problem(name, `${name} es obligatoria cuando se usa S3_BUCKET`);
        }
      }
    } else if (s3Fields.some((name) => value[name])) {
      problem("S3_BUCKET", "Hay variables S3_* sin S3_BUCKET: define el bucket o quítalas");
    }
    if (value.TENANT_BASE_DOMAIN && !HOSTNAME_PATTERN.test(value.TENANT_BASE_DOMAIN)) {
      problem(
        "TENANT_BASE_DOMAIN",
        "TENANT_BASE_DOMAIN debe ser solo un dominio (sin https://, puerto ni rutas)",
      );
    }
    if (
      value.TENANT_PROVISIONING_URL &&
      !/^postgres(ql)?:\/\//.test(value.TENANT_PROVISIONING_URL)
    ) {
      problem("TENANT_PROVISIONING_URL", "TENANT_PROVISIONING_URL debe ser una URL de PostgreSQL");
    }
    if (value.TENANT_TEMPLATE_DB && !/^[a-z][a-z0-9_]{2,62}$/.test(value.TENANT_TEMPLATE_DB)) {
      problem(
        "TENANT_TEMPLATE_DB",
        "TENANT_TEMPLATE_DB solo puede tener minúsculas, números y guion bajo",
      );
    }
    if (value.TENANT_DB_HOST && !HOSTNAME_PATTERN.test(value.TENANT_DB_HOST)) {
      problem("TENANT_DB_HOST", "TENANT_DB_HOST debe ser solo un nombre de host o una IP");
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
      if (!value.PLATFORM_HOST) {
        problem(
          "PLATFORM_HOST",
          "En producción con TENANCY_MODE=multi hace falta PLATFORM_HOST: sin el panel no se pueden administrar los negocios",
        );
      }
      if (value.TENANT_BASE_DOMAIN && LOCAL_HOST_PATTERN.test(value.TENANT_BASE_DOMAIN)) {
        problem(
          "TENANT_BASE_DOMAIN",
          "TENANT_BASE_DOMAIN no puede ser un host local en producción",
        );
      }
      if (value.TENANT_BASE_DOMAIN && PLACEHOLDER_PATTERN.test(value.TENANT_BASE_DOMAIN)) {
        problem(
          "TENANT_BASE_DOMAIN",
          "TENANT_BASE_DOMAIN es un texto de ejemplo: usa tu dominio real",
        );
      }
      if (value.PLATFORM_HOST && PLACEHOLDER_PATTERN.test(value.PLATFORM_HOST)) {
        problem("PLATFORM_HOST", "PLATFORM_HOST es un texto de ejemplo: usa tu dominio real");
      }
    }
    if (value.PLATFORM_HOST && LOCAL_HOST_PATTERN.test(value.PLATFORM_HOST)) {
      problem("PLATFORM_HOST", "PLATFORM_HOST no puede ser un host local en producción");
    }
    if (value.PLATFORM_MASTER_KEY && PLACEHOLDER_PATTERN.test(value.PLATFORM_MASTER_KEY)) {
      problem(
        "PLATFORM_MASTER_KEY",
        "PLATFORM_MASTER_KEY es un texto de ejemplo: genera una propia",
      );
    }
    if (value.TENANT_PROVISIONING_URL && PLACEHOLDER_PATTERN.test(value.TENANT_PROVISIONING_URL)) {
      problem(
        "TENANT_PROVISIONING_URL",
        "TENANT_PROVISIONING_URL tiene la contraseña de ejemplo: usa una propia",
      );
    }
    if (value.CONTROL_DATABASE_URL && PLACEHOLDER_PATTERN.test(value.CONTROL_DATABASE_URL)) {
      problem(
        "CONTROL_DATABASE_URL",
        "CONTROL_DATABASE_URL tiene la contraseña de ejemplo: usa una propia",
      );
    }
    if (!value.UPLOADS_DIR && !value.S3_BUCKET) {
      problem(
        "UPLOADS_DIR",
        "En producción hace falta UPLOADS_DIR (la carpeta, un volumen persistente) o S3_BUCKET (un servicio de objetos) para guardar las fotos de los productos",
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
