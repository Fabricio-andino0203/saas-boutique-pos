import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

/** Borra los usuarios que crean las pruebas E2E (`e2e-*`) para no ensuciar la base de desarrollo. */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está definida (revisa .env)");
  }
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await client.user.deleteMany({ where: { username: { startsWith: "e2e-" } } });
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
