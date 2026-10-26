import { z } from "zod";

import { messages } from "@/config/messages.es";
import { AUTH_LIMITS } from "@/config/constants";

export type FormState = { error?: string; success?: string } | undefined;

export const loginSchema = z.object({
  username: z.string().trim().min(1, messages.auth.validation.required),
  password: z.string().min(1, messages.auth.validation.required),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, messages.auth.validation.required),
    newPassword: z
      .string()
      .min(AUTH_LIMITS.minPasswordLength, messages.auth.validation.passwordTooShort)
      .max(AUTH_LIMITS.maxPasswordLength, messages.auth.validation.passwordTooShort),
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: messages.auth.validation.passwordMismatch,
    path: ["confirmPassword"],
  });

export const pinSchema = z.string().regex(/^\d{4,6}$/, messages.auth.validation.pinFormat);
