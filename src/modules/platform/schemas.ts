import { z } from "zod";

import { PLATFORM_AUTH_LIMITS } from "@/config/constants";
import { platformMessages } from "@/config/messages.platform.es";

const copy = platformMessages.validation;

/** Resultado de un formulario del panel. `redirectTo`: a dónde debe navegar el navegador (ver `actions.ts`). */
export type PlatformFormState =
  | {
      error?: string;
      success?: string;
      redirectTo?: string;
      /** Lo escrito en los campos que no son secretos, para no borrarlo cuando hay un error (React reinicia el formulario). */
      values?: Record<string, string>;
    }
  | undefined;

export const platformLoginSchema = z.object({
  username: z.string().trim().min(1, platformMessages.login.required),
  password: z.string().min(1, platformMessages.login.required),
});

/** El código que escribe la persona: se aceptan espacios ("123 456") y se exigen 6 números. */
export const totpCodeSchema = z.object({
  code: z
    .string()
    .transform((value) => value.replace(/\s/g, ""))
    .pipe(z.string().regex(/^\d{6}$/, platformMessages.verify.invalid)),
});

export const platformPasswordSchema = z
  .string()
  .min(PLATFORM_AUTH_LIMITS.minPasswordLength, copy.passwordTooShort)
  .max(PLATFORM_AUTH_LIMITS.maxPasswordLength, copy.passwordTooShort);

export const platformUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,40}$/, copy.username);

export const createPlatformUserSchema = z.object({
  name: z.string().trim().min(2, copy.name).max(80, copy.name),
  username: platformUsernameSchema,
  password: platformPasswordSchema,
});

export const changePlatformPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, copy.required),
    newPassword: platformPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: copy.passwordMismatch,
    path: ["confirmPassword"],
  });

/** Acciones sobre otro administrador: se confirman con la contraseña de quien las hace. */
export const platformAdminActionSchema = z.object({
  userId: z.string().min(1),
  actorPassword: z.string().min(1, copy.required),
});

export const platformAuditFiltersSchema = z.object({
  action: z.string().trim().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type PlatformAuditFilters = z.infer<typeof platformAuditFiltersSchema>;

/** Lee los filtros de la dirección; un valor inválido simplemente se ignora. */
export function parsePlatformAuditFilters(
  raw: Record<string, string | string[] | undefined>,
): PlatformAuditFilters {
  const pick = (key: string) => {
    const value = raw[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const parsed = platformAuditFiltersSchema.safeParse({
    action: pick("action") || undefined,
    from: pick("from") || undefined,
    to: pick("to") || undefined,
    page: pick("page") || undefined,
  });
  return parsed.success ? parsed.data : { page: 1 };
}
