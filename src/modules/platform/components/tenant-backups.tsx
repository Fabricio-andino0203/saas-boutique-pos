import type { ReactNode } from "react";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { platformMessages } from "@/config/messages.platform.es";
import { formatLocalDate, formatLocalDateTime } from "@/lib/dates";
import {
  BACKED_UP_STATUSES,
  formatBytes,
  getTenantBackupStatus,
  latestUsableBackup,
  listTenantBackups,
} from "@/modules/platform/backups";
import { RelinkForm, RequestBackupForm } from "@/modules/platform/components/backup-forms";

const copy = platformMessages.backups;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/**
 * Los respaldos de un negocio: cómo está el último, los más recientes, cómo pedir uno y cómo restaurarlo. La restauración se
 * hace en el servidor (la clave de los respaldos no está en la aplicación a propósito); el panel muestra los comandos exactos
 * y termina el trabajo que sí es de la aplicación (rol, permisos y versión de los datos).
 */
export async function TenantBackups({
  id,
  slug,
  tenantStatus,
  createdAt,
  database,
}: {
  id: string;
  slug: string;
  /** Estado del negocio (`TenantStatus`): solo quien tiene base en el servidor se respalda. */
  tenantStatus: string;
  createdAt: Date;
  database: string | null;
}) {
  if (!database || !(BACKED_UP_STATUSES as string[]).includes(tenantStatus)) {
    return null;
  }
  const [status, rows, usable] = await Promise.all([
    getTenantBackupStatus(id, createdAt),
    listTenantBackups(id),
    latestUsableBackup(id),
  ]);

  return (
    <section aria-labelledby="backups-title" className="space-y-4" data-testid="tenant-backups">
      <h2 id="backups-title" className="text-lg font-semibold">
        {copy.detail.title}
      </h2>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label={copy.detail.state}>
          <span data-testid="backup-state" data-state={status.state}>
            {copy.states[status.state]}
          </span>
          {status.open ? ` · ${copy.open}` : ""}
        </Fact>
        <Fact label={copy.columns.lastOk}>
          {status.lastOkAt ? formatLocalDateTime(status.lastOkAt) : copy.never}
        </Fact>
        <Fact label={copy.detail.retention}>
          {(status.retentionFromPlan ? copy.days : copy.daysServer).replace(
            "{n}",
            String(status.retentionDays),
          )}
        </Fact>
      </dl>

      <div className="grid max-w-3xl gap-3">
        <RequestBackupForm slug={slug} />
        <RelinkForm slug={slug} />
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{copy.detail.empty}</p>
      ) : (
        <Table data-testid="backup-rows">
          <TableCaption className="sr-only">{copy.detail.title}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.columns.when}</TableHead>
              <TableHead>{copy.columns.kind}</TableHead>
              <TableHead>{copy.columns.state}</TableHead>
              <TableHead>{copy.columns.size}</TableHead>
              <TableHead>{copy.columns.keepUntil}</TableHead>
              <TableHead>{copy.columns.file}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap">
                  {formatLocalDateTime(row.finishedAt ?? row.requestedAt)}
                </TableCell>
                <TableCell>
                  {copy.triggers[row.trigger]}
                  {row.requestedByUsername ? ` · @${row.requestedByUsername}` : ""}
                </TableCell>
                <TableCell>
                  {row.prunedAt ? copy.pruned : copy.statuses[row.status]}
                  {row.error ? (
                    <span className="text-destructive block text-xs">{row.error}</span>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.bytes ? formatBytes(row.bytes) : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.keepUntil && !row.prunedAt ? formatLocalDate(row.keepUntil) : "—"}
                </TableCell>
                <TableCell className="font-mono text-xs break-all">{row.fileName ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <details className="max-w-3xl rounded-md border p-3" data-testid="restore-guide">
        <summary className="cursor-pointer text-sm font-medium">{copy.detail.restoreTitle}</summary>
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-muted-foreground">{copy.detail.restoreIntro}</p>
          <ol className="list-decimal space-y-1 pl-5">
            {copy.detail.restoreSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {usable?.fileName ? (
            <pre className="bg-muted overflow-x-auto rounded p-3 text-xs">
              {[
                `dc exec -T -e RESTORE_REPLACE=yes backup /scripts/restore-tenant.sh /backups/${usable.fileName} ${database}`,
                `dc exec app pnpm tenants:relink ${slug}`,
                `dc exec app pnpm db:verify --tenant ${slug}`,
              ].join("\n")}
            </pre>
          ) : (
            <p className="text-destructive">{copy.detail.noUsable}</p>
          )}
        </div>
      </details>
    </section>
  );
}
