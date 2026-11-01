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
import { platformMessages } from "@/config/messages.platform.es";
import { formatLocalDate, formatLocalDateTime } from "@/lib/dates";
import { DropDatabaseForm, FinalDumpForm } from "@/modules/platform/components/retired-forms";
import { provisioningAvailable } from "@/modules/platform/provisioning";
import { listRetiredDatabases } from "@/modules/platform/retired";

const copy = platformMessages.backups.retired;

/**
 * Las bases apartadas del servidor (archivadas y reemplazadas por una restauración) y lo que falta para poder borrarlas: un
 * volcado final comprobado. Borrar es el último paso y solo se ofrece cuando ese volcado existe.
 */
export async function RetiredDatabases() {
  if (!provisioningAvailable()) {
    return (
      <section className="space-y-3" data-testid="retired-databases">
        <h2 className="text-lg font-semibold">{copy.title}</h2>
        <p role="status" className="text-muted-foreground text-sm">
          {copy.unavailable}
        </p>
      </section>
    );
  }
  const rows = await listRetiredDatabases();

  return (
    <section aria-labelledby="retired-title" className="space-y-3" data-testid="retired-databases">
      <h2 id="retired-title" className="text-lg font-semibold">
        {copy.title}
      </h2>
      <p className="text-muted-foreground max-w-3xl text-sm">{copy.description}</p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{copy.empty}</p>
      ) : (
        <Table>
          <TableCaption className="sr-only">{copy.title}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.columns.database}</TableHead>
              <TableHead>{copy.columns.kind}</TableHead>
              <TableHead>{copy.columns.tenant}</TableHead>
              <TableHead>{copy.columns.since}</TableHead>
              <TableHead>{copy.columns.dump}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.database} data-testid={`retired-row-${row.database}`}>
                <TableCell className="font-mono text-xs break-all">{row.database}</TableCell>
                <TableCell>{copy.kinds[row.kind]}</TableCell>
                <TableCell>
                  {row.slug ? (
                    <Link href={`/negocios/${row.slug}`} className="text-primary underline">
                      {row.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.since ? formatLocalDateTime(row.since) : "—"}
                </TableCell>
                <TableCell className="space-y-2">
                  <div data-testid="final-dump-state" data-state={row.finalDump.state}>
                    {copy.dump[row.finalDump.state]}
                    {row.finalDump.state === "ok" && row.finalDump.keepUntil
                      ? ` · ${copy.keepUntil} ${formatLocalDate(row.finalDump.keepUntil)}`
                      : ""}
                    {row.finalDump.error ? (
                      <span className="text-destructive block text-xs">{row.finalDump.error}</span>
                    ) : null}
                    {row.finalDump.fileName ? (
                      <span className="block font-mono text-xs break-all">
                        {row.finalDump.fileName}
                      </span>
                    ) : null}
                  </div>
                  {row.finalDump.state === "ok" ? (
                    <DropDatabaseForm database={row.database} />
                  ) : row.finalDump.state === "open" ? null : (
                    <FinalDumpForm database={row.database} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
