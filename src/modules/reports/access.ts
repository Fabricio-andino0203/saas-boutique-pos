import { hasCapability, type Role } from "@/lib/permissions";
import type { ReportScope } from "@/modules/reports/queries";

export type ReportAccess = {
  /** Con qué ventas se consulta: todas, o solo las de la persona (el cajero). */
  scope: ReportScope;
  /** Puede ver costos, utilidad y márgenes (`report.financial`). */
  withCosts: boolean;
  /** Ve las ventas de todos (no solo las suyas). */
  seesEveryone: boolean;
};

/**
 * Lo que un usuario puede ver en los reportes. Quien tiene `report.financial` (propietario y gerente) ve todo, con
 * costos y utilidad; quien solo tiene `report.view` (el cajero) ve únicamente sus ventas y nada de costos. Es lo
 * único que decide el alcance: las pantallas y las exportaciones lo piden de aquí.
 */
export function reportAccess(user: { id: string; role: Role }): ReportAccess {
  const financial = hasCapability(user.role, "report.financial");
  return {
    scope: financial ? {} : { onlySellerId: user.id },
    withCosts: financial,
    seesEveryone: financial,
  };
}
