"use server";

import { platformMessages } from "@/config/messages.platform.es";
import { runAsAdmin } from "@/modules/platform/action-support";
import { requestControlBackup, requestTenantBackup } from "@/modules/platform/backups";
import { relinkTenant } from "@/modules/platform/restore";
import type { PlatformFormState } from "@/modules/platform/schemas";

/**
 * Acciones del panel sobre los respaldos: pedir uno ahora (de un negocio o de la base central) y terminar la restauración de un
 * negocio. Todas piden de nuevo la contraseña de quien las hace y quedan en la auditoría. El respaldo en sí lo hace el servicio
 * `backup`; aquí solo se deja el pedido.
 */

const copy = platformMessages.backups.detail;

export async function requestBackupAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runAsAdmin(formData, async (context) => {
    await requestTenantBackup(String(formData.get("slug") ?? ""), context);
    return { success: copy.requested };
  });
}

export async function requestControlBackupAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runAsAdmin(formData, async (context) => {
    await requestControlBackup(context);
    return { success: copy.requested };
  });
}

export async function relinkTenantAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runAsAdmin(formData, async (context) => {
    const report = await relinkTenant(String(formData.get("slug") ?? ""), context);
    return {
      success: copy.relinked
        .replace("{from}", report.schemaFrom ?? "—")
        .replace("{to}", report.schemaTo)
        .replace("{users}", String(report.usersVisible)),
    };
  });
}
