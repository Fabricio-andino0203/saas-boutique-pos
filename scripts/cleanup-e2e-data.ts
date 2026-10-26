import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Borra lo que crean las pruebas E2E para no ensuciar la base de desarrollo:
 * usuarios `e2e-*` y registros de catálogo cuyo nombre empieza por "E2E ".
 * Solo toca datos sin historial (la auditoría no se puede borrar y se conserva).
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está definida (revisa .env)");
  }
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const named = { name: { startsWith: "E2E " } };
    await client.user.deleteMany({ where: { username: { startsWith: "e2e-" } } });
    await client.brand.deleteMany({ where: named });
    await client.season.deleteMany({ where: named });
    await client.size.deleteMany({ where: named });
    await client.color.deleteMany({ where: named });
    await client.supplier.deleteMany({ where: named });
    await client.category.deleteMany({ where: named });
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
