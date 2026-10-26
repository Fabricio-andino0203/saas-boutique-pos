import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { runSeed } from "./seed/run-seed";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está definida (revisa .env)");
  }
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const result = await runSeed(client);
    console.log(`Semilla lista: ${result.users} usuarios de demostración, ubicación MAIN.`);
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
