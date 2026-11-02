import { z } from "zod";

import { PHOTO_LIMITS } from "@/config/constants";

const idSchema = z.string().trim().min(1).max(60);

/** Un id de color elegido para una foto: vacío o ausente = foto general del producto. */
export const photoColorSchema = z
  .string()
  .trim()
  .max(60)
  .nullish()
  .transform((value) => value || null);

export const reorderPhotosSchema = z.object({
  orderedIds: z.array(idSchema).min(1).max(PHOTO_LIMITS.maxPerProduct),
});

/** Lo que se acepta del nombre del archivo subido: solo para mostrarlo, recortado y sin rutas. */
export function cleanFileName(name: string | undefined | null): string | null {
  const base = (name ?? "").split(/[\\/]/).pop()?.trim() ?? "";
  return base === "" ? null : base.slice(0, 120);
}

export type PhotoActionState = { error?: string; success?: string; id?: string } | undefined;
