"use server";

import { platformMessages } from "@/config/messages.platform.es";
import { runAsAdmin } from "@/modules/platform/action-support";
import { dropRetiredDatabase, requestFinalDump } from "@/modules/platform/retired";
import type { PlatformFormState } from "@/modules/platform/schemas";
import { collectUsage } from "@/modules/platform/usage";
import { recordPlatformAudit } from "@/modules/platform/audit";
import { controlDb } from "@/lib/tenancy/control-db";

/**
 * Acciones del panel sobre las bases apartadas (volcado final y borrado definitivo) y sobre el uso de un negocio. Todas piden
 * de nuevo la contraseña de quien las hace y quedan en la auditoría.
 */

const copy = platformMessages;

export async function requestFinalDumpAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runAsAdmin(formData, async (context) => {
    await requestFinalDump(String(formData.get("database") ?? ""), context);
    return { success: copy.backups.retired.dumpRequested };
  });
}

export async function dropRetiredDatabaseAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runAsAdmin(formData, async (context) => {
    await dropRetiredDatabase(
      {
        database: String(formData.get("database") ?? ""),
        confirm: String(formData.get("confirm") ?? ""),
      },
      context,
    );
    return { success: copy.backups.retired.dropped };
  });
}

export async function refreshUsageAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runAsAdmin(formData, async (context) => {
    const slug = String(formData.get("slug") ?? "");
    const report = await collectUsage({ only: [slug] });
    const failure = report.failed[0];
    if (failure) {
      return { error: failure.error };
    }
    await recordPlatformAudit(controlDb, {
      action: "USAGE_REFRESHED",
      actor: context.actor,
      details: { slug },
      ip: context.ip,
    });
    return { success: copy.usage.refreshed };
  });
}
