import "dotenv/config";

import { db } from "../src/lib/db";
import { expireAllOverdueLayaways } from "../src/modules/layaways/service";

/**
 * Tarea diaria para el cron del servidor: vence los apartados cuyo plazo ya pasó, libera sus prendas y manda lo abonado
 * a crédito de tienda. Es segura de repetir: si no hay nada vencido, no hace nada.
 */
async function main(): Promise<void> {
  const expired = await expireAllOverdueLayaways(db);
  console.log(`Apartados vencidos: ${expired}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
