"use client";

import { useActionState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { platformMessages } from "@/config/messages.platform.es";
import { useRefreshOnSuccess } from "@/modules/platform/components/use-redirect-on-state";
import type { PlatformFormState } from "@/modules/platform/schemas";
import {
  archiveTenantAction,
  cancelTenantDeletionAction,
  migrateTenantAction,
  reactivateTenantAction,
  requestTenantDeletionAction,
  resumeProvisioningAction,
  setTenantCanaryAction,
  suspendTenantAction,
  undoProvisioningAction,
} from "@/modules/platform/tenant-actions";

const copy = platformMessages.tenants.actions;

type TenantAction = (previous: PlatformFormState, formData: FormData) => Promise<PlatformFormState>;

/**
 * Una acción sobre un negocio: se despliega, explica qué hace, pide la contraseña de quien la hace (y lo que haga falta) y se
 * confirma. Igual que las acciones sobre administradores.
 */
function ActionForm({
  slug,
  name,
  label,
  hint,
  action,
  destructive = false,
  children,
}: {
  slug: string;
  name: string;
  label: string;
  hint?: string;
  action: TenantAction;
  destructive?: boolean;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  useRefreshOnSuccess(state);
  const passwordId = `confirm-${name}-${slug}`;

  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">{label}</summary>
      <form action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="slug" value={slug} />
        {hint ? <p className="text-muted-foreground text-sm">{hint}</p> : null}
        {children}
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor={passwordId} className="text-muted-foreground block text-sm">
              {copy.confirmPassword}
            </label>
            <Input
              id={passwordId}
              name="actorPassword"
              type="password"
              autoComplete="current-password"
              className="w-48"
              required
            />
          </div>
          <Button
            type="submit"
            size="sm"
            variant={destructive ? "destructive" : "outline"}
            loading={pending}
          >
            {label}
          </Button>
        </div>
        {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
        {state?.success ? <Notice tone="success">{state.success}</Notice> : null}
      </form>
    </details>
  );
}

export type TenantActionsProps = {
  slug: string;
  status:
    | "PROVISIONING"
    | "ACTIVE"
    | "SUSPENDED"
    | "PENDING_DELETION"
    | "DELETED"
    | "FAILED"
    | "MIGRATION_FAILED";
  canary: boolean;
  /** `true` si el negocio llegó por el alta automática y su alta no terminó (se puede retomar o deshacer). */
  hasUnfinishedRun: boolean;
  /** `true` si la retención de la baja ya terminó (el archivado no necesita la casilla de «antes de tiempo»). */
  retentionOver: boolean;
};

export function TenantActions({
  slug,
  status,
  canary,
  hasUnfinishedRun,
  retentionOver,
}: TenantActionsProps) {
  if (status === "DELETED") {
    return null;
  }
  const serving = status === "ACTIVE" || status === "SUSPENDED" || status === "MIGRATION_FAILED";

  return (
    <section aria-labelledby="tenant-actions-title" className="space-y-3">
      <h2 id="tenant-actions-title" className="text-lg font-semibold">
        {copy.title}
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        {status === "ACTIVE" ? (
          <ActionForm
            slug={slug}
            name="suspend"
            label={copy.suspend}
            hint={copy.hints.suspend}
            action={suspendTenantAction}
          />
        ) : null}
        {status === "SUSPENDED" ? (
          <ActionForm
            slug={slug}
            name="reactivate"
            label={copy.reactivate}
            hint={copy.hints.reactivate}
            action={reactivateTenantAction}
          />
        ) : null}
        {hasUnfinishedRun && (status === "FAILED" || status === "PROVISIONING") ? (
          <>
            <ActionForm
              slug={slug}
              name="resume"
              label={copy.resume}
              hint={copy.hints.resume}
              action={resumeProvisioningAction}
            />
            <ActionForm
              slug={slug}
              name="undo"
              label={copy.undo}
              hint={copy.hints.undo}
              action={undoProvisioningAction}
              destructive
            />
          </>
        ) : null}
        {serving ? (
          <ActionForm
            slug={slug}
            name="migrate"
            label={copy.migrate}
            hint={copy.hints.migrate}
            action={migrateTenantAction}
          />
        ) : null}
        {serving ? (
          <ActionForm
            slug={slug}
            name="canary"
            label={canary ? copy.canaryOff : copy.canaryOn}
            action={setTenantCanaryAction}
          >
            <input type="hidden" name="canary" value={canary ? "off" : "on"} />
          </ActionForm>
        ) : null}
        {serving ? (
          <ActionForm
            slug={slug}
            name="requestDeletion"
            label={copy.requestDeletion}
            hint={copy.hints.requestDeletion}
            action={requestTenantDeletionAction}
            destructive
          >
            <div className="space-y-1">
              <label htmlFor={`reason-${slug}`} className="text-muted-foreground block text-sm">
                {copy.reason}
              </label>
              <Input id={`reason-${slug}`} name="reason" autoComplete="off" required />
            </div>
          </ActionForm>
        ) : null}
        {status === "PENDING_DELETION" ? (
          <>
            <ActionForm
              slug={slug}
              name="cancelDeletion"
              label={copy.cancelDeletion}
              action={cancelTenantDeletionAction}
            />
            <ActionForm
              slug={slug}
              name="archive"
              label={copy.archive}
              hint={copy.hints.archive}
              action={archiveTenantAction}
              destructive
            >
              <div className="space-y-1">
                <label
                  htmlFor={`confirm-slug-${slug}`}
                  className="text-muted-foreground block text-sm"
                >
                  {copy.confirmSlug}
                </label>
                <Input id={`confirm-slug-${slug}`} name="confirm" autoComplete="off" required />
              </div>
              {retentionOver ? null : (
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" name="early" />
                  {copy.early}
                </label>
              )}
            </ActionForm>
          </>
        ) : null}
      </div>
    </section>
  );
}
