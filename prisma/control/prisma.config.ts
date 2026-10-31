import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Configuración de la base central: se usa con `prisma <comando> --config prisma/control/prisma.config.ts`.
export default defineConfig({
  schema: "schema.prisma",
  migrations: { path: "migrations" },
  datasource: { url: env("CONTROL_DATABASE_URL") },
});
