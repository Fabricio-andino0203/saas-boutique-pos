import Link from "next/link";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { platformMessages } from "@/config/messages.platform.es";
import { formatLocalDateTime } from "@/lib/dates";
import { BACKED_UP_STATUSES } from "@/modules/platform/backups";
import { CloseSupportForm, OpenSupportForm } from "@/modules/platform/components/support-forms";
import { getOpenSupportSession, isOpen, listSupportSessions } from "@/modules/platform/support";

const copy = platformMessages.support;

/** Soporte de un negocio: abrir o cerrar una sesión, entrar a ver sus datos y el historial de sesiones. */
export async function TenantSupport({
  id,
  slug,
  tenantStatus,
  adminId,
}: {
  id: string;
  slug: string;
  tenantStatus: string;
  adminId: string;
}) {
  if (!(BACKED_UP_STATUSES as string[]).includes(tenantStatus)) {
    return null;
  }
  const [current, history] = await Promise.all([
    getOpenSupportSession(slug, adminId),
    listSupportSessions(id),
  ]);
  const now = new Date();

  return (
    <section aria-labelledby="support-title" className="space-y-4" data-testid="tenant-support">
      <h2 id="support-title" className="text-lg font-semibold">
        {copy.title}
      </h2>
      <p className="text-muted-foreground max-w-3xl text-sm">{copy.description}</p>

      {current ? (
        <div className="max-w-3xl space-y-3 rounded-md border p-4" data-testid="support-current">
          <p className="font-medium">{copy.current.title}</p>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-0.5">
              <dt className="text-muted-foreground text-xs">{copy.current.reason}</dt>
              <dd className="text-sm">{current.reason}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-muted-foreground text-xs">{copy.current.expires}</dt>
              <dd className="text-sm">{formatLocalDateTime(current.expiresAt)}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/negocios/${slug}/soporte`} className={buttonVariants()}>
              {copy.current.view}
            </Link>
          </div>
          <CloseSupportForm slug={slug} />
        </div>
      ) : (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{copy.open.title}</h3>
          <OpenSupportForm slug={slug} />
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{copy.history.title}</h3>
        {history.length === 0 ? (
          <p className="text-muted-foreground text-sm">{copy.history.empty}</p>
        ) : (
          <Table data-testid="support-history">
            <TableCaption className="sr-only">{copy.history.title}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.history.columns.who}</TableHead>
                <TableHead>{copy.history.columns.reason}</TableHead>
                <TableHead>{copy.history.columns.start}</TableHead>
                <TableHead>{copy.history.columns.end}</TableHead>
                <TableHead>{copy.history.columns.state}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>@{row.adminUsername}</TableCell>
                  <TableCell>{row.reason}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatLocalDateTime(row.startedAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatLocalDateTime(row.endedAt ?? row.expiresAt)}
                  </TableCell>
                  <TableCell>
                    {isOpen(row, now)
                      ? copy.history.open
                      : row.endedAt
                        ? copy.history.closed
                        : copy.history.expired}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}
