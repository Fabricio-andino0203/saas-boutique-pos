"use server";

import { redirect } from "next/navigation";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";
import { text } from "@/lib/form-data";
import type { FormState } from "@/modules/auth/schemas";
import { createUserSchema, updateUserSchema } from "@/modules/users/schemas";
import {
  createUser,
  resetPassword,
  resetPin,
  setUserActive,
  updateUser,
} from "@/modules/users/service";

export async function createUserAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createUserSchema.safeParse({
    name: text(formData, "name"),
    username: text(formData, "username"),
    role: text(formData, "role"),
    password: text(formData, "password"),
    pin: text(formData, "pin"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? messages.errors.VALIDATION };
  }

  const { user } = await requireUserCapability("user.manage");
  const result = await toActionResult(() => createUser(user, parsed.data), messages.errors);
  if (!result.ok) {
    return { error: result.error.message };
  }
  redirect("/usuarios");
}

export async function updateUserAction(
  id: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateUserSchema.safeParse({
    name: text(formData, "name"),
    role: text(formData, "role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? messages.errors.VALIDATION };
  }

  const { user } = await requireUserCapability("user.manage");
  const result = await toActionResult(() => updateUser(user, id, parsed.data), messages.errors);
  return result.ok ? { success: messages.users.updated } : { error: result.error.message };
}

export async function setUserActiveAction(id: string, active: boolean): Promise<FormState> {
  const { user } = await requireUserCapability("user.manage");
  const result = await toActionResult(() => setUserActive(user, id, active), messages.errors);
  if (!result.ok) {
    return { error: result.error.message };
  }
  return { success: active ? messages.users.reactivated : messages.users.deactivated };
}

export async function resetPasswordAction(
  id: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { user } = await requireUserCapability("user.manage");
  const result = await toActionResult(
    () => resetPassword(user, id, text(formData, "newPassword")),
    messages.errors,
  );
  return result.ok
    ? { success: messages.users.resetPassword.done }
    : { error: result.error.message };
}

export async function resetPinAction(
  id: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { user } = await requireUserCapability("user.manage");
  const result = await toActionResult(
    () => resetPin(user, id, text(formData, "pin")),
    messages.errors,
  );
  return result.ok ? { success: messages.users.resetPin.done } : { error: result.error.message };
}
