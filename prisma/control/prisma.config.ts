import "dotenv/config";
import { defineConfig } from "prisma/config";

// Configuración de la base central: se usa con `prisma <comando> --config prisma/control/prisma.config.ts`
// (los scripts `control:*` de package.json ya lo hacen). Sin CONTROL_DATABASE_URL solo funciona `generate`.
const url = process.env.CONTROL_DATABASE_URL;

export default defineConfig({
  schema: "schema.prisma",
  migrations: { path: "migrations" },
  ...(url ? { datasource: { url } } : {}),
});
