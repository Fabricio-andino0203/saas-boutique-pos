/**
 * Identificador para una operación que no debe repetirse (un cobro, una devolución). `crypto.randomUUID` solo existe
 * en contextos seguros (https o localhost): en una red local con http se usa un respaldo.
 */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
