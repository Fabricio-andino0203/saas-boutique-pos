"use server";

import { platformMessages } from "@/config/messages.platform.es";
import { ConflictError } from "@/lib/errors";
import { getPlatformSession } from "@/lib/platform-auth";
import { asFormState, countingFailures, requestContext } from "@/modules/platform/action-support";
import { migrateFleet } from "@/modules/platform/fleet";
import {
  archiveTenant,
  cancelTenantDeletion,
  requestTenantDeletion,
} from "@/modules/platform/lifecycle";
import {
  resumeProvisioning,
  startProvisioning,
  undoProvisioning,
} from "@/modules/platform/provisioning";
import { platformTenantActionSchema, type PlatformFormState } from "@/modules/platform/schemas";
import { confirmActorPassword } from "@/modules/platform/service";
import { setTenantCanary, setTenantStatus } from "@/modules/platform/tenants";

/**
 * Acciones del panel sobre los negocios: dar de alta, suspender, retomar o deshacer un alta, actualizar sus datos y la baja
 * controlada. Todas piden de nuevo la contraseña de quien las hace y quedan en la auditoría. Como el resto del panel, ninguna
 * usa `redirect()` (ver `actions.ts`): devuelven `redirectTo` y navega el navegador.
 */

const LOGIN_PATH = "/login";
const copy = platformMessages.tenants;

type Operation =
  | "suspend"
  | "reactivate"
  | "resume"
  | "undo"
  | "migrate"
  | "canaryOn"
  | "canaryOff"
  | "requestDeletion"
  | "cancelDeletion"
  | "archive";

async function runOperation(formData: FormData, operation: Operation): Promise<PlatformFormState> {
  const parsed = platformTenantActionSchema.safeParse({
    slug: formData.get("slug"),
    actorPassword: formData.get("actorPassword"),
  });
  if (!parsed.success) {
    return { error: platformMessages.validation.required };
  }
  const session = await getPlatformSession();
  if (!session) {
    return { redirectTo: LOGIN_PATH };
  }
  const request = await requestContext();
  const actor = { id: session.user.id, username: session.user.username };
  const context = { actor, ip: request.ip };
  const { slug, actorPassword } = parsed.data;

  return asFormState(async () => {
    await countingFailures(request.ip, async () => {
      await confirmActorPassword(actor.id, actorPassword, request);
    });
    switch (operation) {
      case "suspend":
        await setTenantStatus({ slug, status: "SUSPENDED" }, context);
        break;
      case "reactivate":
        await setTenantStatus({ slug, status: "ACTIVE" }, context);
        break;
      case "resume": {
        const outcome = await resumeProvisioning(slug, context);
        if (outcome.status === "FAILED") {
          throw new ConflictError(
            `${copy.actions.provisionFailed} «${outcome.step}»: ${outcome.error}`,
          );
        }
        break;
      }
      case "undo":
        await undoProvisioning(slug, context);
        break;
      case "migrate": {
        const report = await migrateFleet({ only: [slug], force: true }, context);
        const failed = report.entries.find((entry) => entry.result === "failed");
        if (failed) {
          throw new ConflictError(failed.error ?? "La actualización falló");
        }
        break;
      }
      case "canaryOn":
      case "canaryOff":
        await setTenantCanary({ slug, canary: operation === "canaryOn" }, context);
        break;
      case "requestDeletion":
        await requestTenantDeletion(
          { slug, reason: String(formData.get("reason") ?? "") },
          context,
        );
        break;
      case "cancelDeletion":
        await cancelTenantDeletion(slug, context);
        break;
      case "archive":
        await archiveTenant(
          {
            slug,
            confirm: String(formData.get("confirm") ?? ""),
            early: formData.get("early") === "on",
          },
          context,
        );
        break;
    }
    return { success: copy.actions.done[operation] };
  });
}

export async function suspendTenantAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runOperation(formData, "suspend");
}

export async function reactivateTenantAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runOperation(formData, "reactivate");
}

export async function resumeProvisioningAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runOperation(formData, "resume");
}

export async function undoProvisioningAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runOperation(formData, "undo");
}

export async function migrateTenantAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runOperation(formData, "migrate");
}

export async function setTenantCanaryAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runOperation(formData, formData.get("canary") === "on" ? "canaryOn" : "canaryOff");
}

export async function requestTenantDeletionAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runOperation(formData, "requestDeletion");
}

export async function cancelTenantDeletionAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runOperation(formData, "cancelDeletion");
}

export async function archiveTenantAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runOperation(formData, "archive");
}

/** Actualiza los datos de **todos** los negocios (canarios primero). Devuelve el resumen para mostrarlo. */
export async function migrateFleetAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const actorPassword = String(formData.get("actorPassword") ?? "");
  if (!actorPassword) {
    return { error: platformMessages.validation.required };
  }
  const session = await getPlatformSession();
  if (!session) {
    return { redirectTo: LOGIN_PATH };
  }
  const request = await requestContext();
  const actor = { id: session.user.id, username: session.user.username };
  return asFormState(async () => {
    await countingFailures(request.ip, async () => {
      await confirmActorPassword(actor.id, actorPassword, request);
    });
    const report = await migrateFleet({}, { actor, ip: request.ip });
    const summary = copy.review.migrateAll.result
      .replace("{migrated}", String(report.migrated))
      .replace("{skipped}", String(report.skipped))
      .replace("{failed}", String(report.failed))
      .replace("{blocked}", String(report.blocked));
    return report.failed + report.blocked > 0 ? { error: summary } : { success: summary };
  });
}

/** Da de alta un negocio nuevo. Conserva lo escrito (menos las contraseñas) si algo no es válido. */
export async function provisionTenantAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const text = (name: string) => String(formData.get(name) ?? "");
  const values = {
    name: text("name"),
    slug: text("slug"),
    ownerName: text("ownerName"),
    ownerUsername: text("ownerUsername"),
    ownerEmail: text("ownerEmail"),
    planId: text("planId"),
  };
  const actorPassword = text("actorPassword");
  if (!actorPassword) {
    return { error: platformMessages.validation.required, values };
  }
  const session = await getPlatformSession();
  if (!session) {
    return { redirectTo: LOGIN_PATH };
  }
  const request = await requestContext();
  const actor = { id: session.user.id, username: session.user.username };

  return asFormState(async () => {
    await countingFailures(request.ip, async () => {
      await confirmActorPassword(actor.id, actorPassword, request);
    });
    const outcome = await startProvisioning(
      { ...values, ownerPassword: text("ownerPassword") },
      { actor, ip: request.ip },
    );
    // Éxito o fallo, se va al detalle del negocio: ahí se ve cómo terminó cada paso y qué hacer.
    return { redirectTo: `/negocios/${outcome.slug}` };
  }, values);
}
