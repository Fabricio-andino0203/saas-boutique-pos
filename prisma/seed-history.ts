import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { generateHistory } from "./seed/history";

/**
 * Carga un año de ventas de prueba para probar los reportes (`pnpm db:seed:history`). Solo para desarrollo: agrega
 * unas 6 500 ventas, devoluciones, turnos de caja cerrados y 40 productos "HIST-". Para quitarlo: `pnpm db:reset`.
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está definida (revisa .env)");
  }
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const started = Date.now();
    const result = await generateHistory(client);
    console.log(
      `Historia lista en ${Math.round((Date.now() - started) / 1000)} s: ${result.sales} ventas (${result.lines} líneas), ` +
        `${result.returns} devoluciones, ${result.sessions} turnos, ${result.variants} prendas y ${result.customers} clientes de prueba.`,
    );
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
