import type { ImportPlan, ImportProblem } from "./plan";

/** Lo que la pantalla necesita saber del plan (sin el detalle de cada fila). */
export type ImportPreview = {
  totals: ImportPlan["totals"];
  created: ImportPlan["created"];
  costIgnored: boolean;
  problemCount: number;
  /** Los primeros problemas; el resto se corrige en la siguiente vuelta. */
  problems: ImportProblem[];
};

export type ImportActionState =
  { error: string } | { preview: ImportPreview } | { done: ImportPlan["totals"] };

export const MAX_PROBLEMS_SHOWN = 200;

export function toPreview(plan: ImportPlan): ImportPreview {
  return {
    totals: plan.totals,
    created: plan.created,
    costIgnored: plan.costIgnored,
    problemCount: plan.problems.length,
    problems: plan.problems.slice(0, MAX_PROBLEMS_SHOWN),
  };
}
