"use server";

import { platformMessages } from "@/config/messages.platform.es";
import { runAsAdmin } from "@/modules/platform/action-support";
import type { PlatformFormState } from "@/modules/platform/schemas";
import {
  closeSupportSession,
  openSupportSession,
  resetBusinessUserPassword,
  unlockBusinessUser,
} from "@/modules/platform/support";

/**
 * Acciones del panel sobre las sesiones de soporte. Todas piden de nuevo la contraseña de quien las hace y quedan en la
 * auditoría de la plataforma.
 */

const copy = platformMessages.support;
const text = (formData: FormData, name: string): string => String(formData.get(name) ?? "");

export async function openSupportSessionAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  // Se conserva lo escrito si algo no es válido (React reinicia el formulario al terminar la acción).
  const values = { reason: text(formData, "reason"), minutes: text(formData, "minutes") };
  return runAsAdmin(
    formData,
    async (context) => {
      await openSupportSession(
        {
          slug: text(formData, "slug"),
          reason: values.reason,
          minutes: Number(values.minutes),
        },
        context,
      );
      return { success: copy.open.done };
    },
    values,
  );
}

export async function closeSupportSessionAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runAsAdmin(formData, async (context) => {
    await closeSupportSession(text(formData, "slug"), context);
    return { success: copy.current.closed };
  });
}

export async function unlockBusinessUserAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runAsAdmin(formData, async (context) => {
    const { username } = await unlockBusinessUser(
      { slug: text(formData, "slug"), userId: text(formData, "userId") },
      context,
    );
    return { success: copy.actions.unlocked.replace("{user}", username) };
  });
}

export async function resetBusinessUserPasswordAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runAsAdmin(formData, async (context) => {
    const { username, temporaryPassword } = await resetBusinessUserPassword(
      { slug: text(formData, "slug"), userId: text(formData, "userId") },
      context,
    );
    return {
      success: copy.actions.resetDone
        .replace("{user}", username)
        .replace("{password}", temporaryPassword),
    };
  });
}
