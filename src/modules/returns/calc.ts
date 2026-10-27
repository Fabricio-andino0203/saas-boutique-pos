import { ValidationError } from "@/lib/errors";
import { allocate, sumCents, type Cents } from "@/lib/money";

/**
 * Regla de prorrateo de devoluciones (ARCHITECTURE §6).
 *
 * Lo que pagó el cliente por una línea (`lineTotalCents`: precio por cantidad, menos su descuento y su parte del
 * descuento global, con el ISV dentro) se reparte en una parte por unidad con `allocate` (mayor residuo; el
 * sobrante de centavos va a las primeras unidades). Las unidades se devuelven en orden: la primera que se devuelve
 * es la primera parte, y así. Así, devolver todas las unidades, de una vez o en partes, reembolsa siempre exactamente
 * lo pagado por la línea: ni un centavo de más ni de menos, y ninguna parte es negativa.
 */
export function unitShares(totalCents: Cents, quantity: number): Cents[] {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new ValidationError("quantity must be a positive integer");
  }
  return allocate(
    totalCents,
    Array.from({ length: quantity }, () => 1),
  );
}

/**
 * Cuánto vale devolver `returning` unidades de una línea de `quantity`, de la que ya se devolvieron `alreadyReturned`.
 * Sirve igual para el reembolso (`lineTotalCents`) que para el ISV de esa parte (`taxCents`).
 */
export function valueOfUnits(
  totalCents: Cents,
  quantity: number,
  alreadyReturned: number,
  returning: number,
): Cents {
  if (!Number.isInteger(alreadyReturned) || alreadyReturned < 0) {
    throw new ValidationError("alreadyReturned must be zero or more");
  }
  if (!Number.isInteger(returning) || returning < 1) {
    throw new ValidationError("returning must be at least one unit");
  }
  if (alreadyReturned + returning > quantity) {
    throw new ValidationError("Cannot return more units than were sold");
  }
  return sumCents(
    unitShares(totalCents, quantity).slice(alreadyReturned, alreadyReturned + returning),
  );
}
