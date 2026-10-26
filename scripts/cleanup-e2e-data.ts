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

    // Los productos de prueba se crean sin existencias (el kardex no se puede borrar): primero sus
    // variantes e historial, luego ellos, y después los catálogos que usaban.
    const products = await client.product.findMany({ where: named, select: { id: true } });
    const productIds = products.map((product) => product.id);
    const ofProducts = { productId: { in: productIds } };
    await client.priceHistory.deleteMany({
      where: { OR: [ofProducts, { variant: ofProducts }] },
    });
    await client.variant.deleteMany({ where: ofProducts });
    await client.product.deleteMany({ where: { id: { in: productIds } } });

    await client.fiscalRange.deleteMany({ where: { prefix: { startsWith: "E2E-" } } });
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
