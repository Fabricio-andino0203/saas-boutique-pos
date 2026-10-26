import { z } from "zod";

import { AUTH_LIMITS } from "@/config/constants";
import { messages } from "@/config/messages.es";
import { ROLES } from "@/lib/permissions";
import { pinSchema } from "@/modules/auth/schemas";

const name = z.string().trim().min(1, messages.users.validation.name).max(120);
const role = z.enum(ROLES, { error: messages.users.validation.role });
const password = z
  .string()
  .min(AUTH_LIMITS.minPasswordLength, messages.auth.validation.passwordTooShort)
  .max(AUTH_LIMITS.maxPasswordLength, messages.auth.validation.passwordTooShort);

export const createUserSchema = z.object({
  name,
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,30}$/, messages.users.validation.username),
  role,
  password,
  pin: z.preprocess((value) => (value === "" ? undefined : value), pinSchema.optional()),
});

export const updateUserSchema = z.object({ name, role });
export const resetPasswordSchema = z.object({ newPassword: password });
export const resetPinSchema = z.object({ pin: pinSchema });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
