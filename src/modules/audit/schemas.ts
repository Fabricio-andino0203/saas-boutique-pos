import { z } from "zod";

import { AUDIT_ACTIONS } from "@/lib/audit";

const empty = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optionalText = (max: number) =>
  z.preprocess(empty, z.string().max(max).optional()).catch(undefined);

/** Filtros de la pantalla de auditoría. Cualquier valor inválido se ignora en vez de fallar. */
export const auditFiltersSchema = z.object({
  action: z.preprocess(empty, z.enum(AUDIT_ACTIONS).optional()).catch(undefined),
  entityType: optionalText(60),
  userId: optionalText(40),
  from: optionalText(10),
  to: optionalText(10),
  page: z.preprocess(empty, z.coerce.number().int().min(1).default(1)).catch(1),
});

export type AuditFilters = z.infer<typeof auditFiltersSchema>;

/** Convierte los `searchParams` de Next (valor o lista) en filtros válidos. */
export function parseAuditFilters(
  searchParams: Record<string, string | string[] | undefined>,
): AuditFilters {
  const flat = Object.fromEntries(
    Object.entries(searchParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  return auditFiltersSchema.parse(flat);
}
