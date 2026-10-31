import "dotenv/config";

import { writeFileSync } from "node:fs";

import { seedBase } from "../../prisma/seed/run-seed";
import {
  createTemplateDatabase,
  createTenantDatabase,
  dropTenantDatabase,
  urlFor,
  withClient,
} from "../../src/lib/tenancy/provision-db";
import { createFirstOwner } from "../../src/modules/users/bootstrap";

/**
 * Prueba de concepto (Etapa 0): crea dos negocios de demostración con su propia base y rol, y escribe en un archivo el
 * directorio host → negocio que usa la app en modo `multi` (el archivo lleva credenciales: no se versiona ni se imprime).
 *
 * Uso: DATABASE_URL=<cuenta de aprovisionamiento> tsx scripts/poc/provision-demo.ts <archivo de salida>
 */
const TEMPLATE = "poc_demo_template";

const BUSINESSES = [
  { key: "a", host: "a.localhost", name: "Boutique Tienda A", password: "Clave-Negocio-A-2026" },
  { key: "b", host: "b.localhost", name: "Boutique Tienda B", password: "Clave-Negocio-B-2026" },
] as const;

async function main(): Promise<void> {
  const output = process.argv[2];
  const adminUrl = process.env.DATABASE_URL;
  if (!output || !adminUrl) {
    throw new Error("Uso: DATABASE_URL=... tsx scripts/poc/provision-demo.ts <archivo de salida>");
  }

  const started = performance.now();
  await createTemplateDatabase(adminUrl, TEMPLATE);
  console.log(`Plantilla migrada en ${Math.round(performance.now() - started)} ms`);

  const directory: Record<string, { id: string; databaseUrl: string }> = {};
  for (const business of BUSINESSES) {
    const id = `demo_${business.key}`;
    await dropTenantDatabase(adminUrl, id);
    const t0 = performance.now();
    const provisioned = await createTenantDatabase(adminUrl, { id, template: TEMPLATE });
    const copied = Math.round(performance.now() - t0);

    // El mismo usuario ("dueno") en los dos negocios, con contraseñas distintas.
    await withClient(urlFor(adminUrl, { database: provisioned.database }), async (client) => {
      await seedBase(client);
      await createFirstOwner(
        { name: `Dueño de ${business.name}`, username: "dueno", password: business.password },
        client,
      );
      await client.businessProfile.updateMany({ data: { legalName: business.name } });
    });
    directory[business.host] = { id, databaseUrl: provisioned.appUrl };
    console.log(`${business.name}: base creada desde la plantilla en ${copied} ms`);
  }

  writeFileSync(output, JSON.stringify(directory), "utf8");
  console.log(`Directorio escrito (${Object.keys(directory).length} negocios)`);
}

main().catch(async (error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
