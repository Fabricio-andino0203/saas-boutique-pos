import "dotenv/config";

import { db } from "../src/lib/db";
import { findStockDiscrepancies } from "../src/modules/inventory/reconcile";

/**
 * Reconciliación de inventario: compara, por variante y ubicación, la suma de los movimientos del
 * kardex con la existencia acumulada. Sale con código 1 si algo no cuadra (sirve en CI y en cron).
 */
async function main(): Promise<void> {
  const discrepancies = await findStockDiscrepancies(db);
  if (discrepancies.length === 0) {
    console.log("Inventario conciliado: la suma del kardex coincide con las existencias.");
    return;
  }
  console.error(`Hay ${discrepancies.length} diferencia(s) entre el kardex y las existencias:`);
  console.table(discrepancies);
  process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
