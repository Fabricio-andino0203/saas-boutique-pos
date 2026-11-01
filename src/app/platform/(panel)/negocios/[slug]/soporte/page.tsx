import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
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
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { requirePlatformSession } from "@/lib/platform-auth";
import { requestContext } from "@/modules/platform/action-support";
import { ResetPasswordForm, UnlockUserForm } from "@/modules/platform/components/support-forms";
import { getTenantDetail } from "@/modules/platform/queries";
import { getOpenSupportSession, viewSupport, type SupportView } from "@/modules/platform/support";

const copy = platformMessages.support;
const view = copy.view;

type Props = { params: Promise<{ slug: string }> };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function PlatformSupportPage({ params }: Props) {
  const { user } = await requirePlatformSession();
  const { slug } = await params;
  const tenant = await getTenantDetail(slug);
  if (!tenant) {
    notFound();
  }
  const back = (
    <Link href={`/negocios/${slug}`} className="text-primary text-sm underline">
      {view.back}
    </Link>
  );
  const session = await getOpenSupportSession(slug, user.id);

  // Sin una sesión abierta no se lee nada del negocio.
  if (!session) {
    return (
      <div className="space-y-6">
        <PageHeader title={`${copy.title}: ${tenant.name}`} actions={back} />
        <p role="status" className="max-w-3xl text-sm" data-testid="support-no-session">
          {view.noSession} {view.openIt}
        </p>
      </div>
    );
  }

  let data: SupportView | undefined;
  let failure: string | undefined;
  try {
    const request = await requestContext();
    data = await viewSupport(
      slug,
      { actor: { id: user.id, username: user.username }, ip: request.ip },
      {},
    );
  } catch (error) {
    failure = error instanceof Error ? error.message.split("\n")[0] : String(error);
  }

  return (
    <div className="space-y-8" data-testid="support-view">
      <PageHeader title={`${copy.title}: ${tenant.name}`} actions={back} />
      <p className="text-muted-foreground max-w-3xl text-sm">
        {view.session
          .replace("{user}", session.adminUsername)
          .replace("{time}", formatLocalDateTime(session.expiresAt))}{" "}
        {copy.current.reason}: {session.reason}
      </p>

      {failure || !data ? (
        <p role="alert" className="text-destructive text-sm">
          {view.readError} {failure}
        </p>
      ) : (
        <>
          <Section title={view.sections.users}>
            <Table data-testid="support-users">
              <TableCaption className="sr-only">{view.sections.users}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{view.columns.name}</TableHead>
                  <TableHead>{view.columns.username}</TableHead>
                  <TableHead>{view.columns.role}</TableHead>
                  <TableHead>{view.columns.state}</TableHead>
                  <TableHead>{view.columns.lastLogin}</TableHead>
                  <TableHead>{view.columns.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.users.map((person) => {
                  const locked = person.lockedUntil && person.lockedUntil > new Date();
                  return (
                    <TableRow key={person.id} data-testid={`support-user-${person.username}`}>
                      <TableCell className="font-medium">{person.name}</TableCell>
                      <TableCell>@{person.username}</TableCell>
                      <TableCell>{view.roles[person.role]}</TableCell>
                      <TableCell>
                        {person.isActive ? view.active : view.inactive}
                        {locked && person.lockedUntil ? (
                          <span className="text-destructive block text-xs">
                            {view.lockedUntil} {formatLocalDateTime(person.lockedUntil)}
                          </span>
                        ) : null}
                        {person.failedLogins > 0 ? (
                          <span className="text-muted-foreground block text-xs">
                            {view.failedLogins.replace("{n}", String(person.failedLogins))}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {person.lastLoginAt ? formatLocalDateTime(person.lastLoginAt) : "—"}
                      </TableCell>
                      <TableCell className="space-y-2">
                        <UnlockUserForm slug={slug} userId={person.id} />
                        <ResetPasswordForm slug={slug} userId={person.id} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Section>

          <Section title={view.sections.sales}>
            {data.sales.length === 0 ? (
              <p className="text-muted-foreground text-sm">{view.empty}</p>
            ) : (
              <Table data-testid="support-sales">
                <TableCaption className="sr-only">{view.sections.sales}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{view.columns.sale}</TableHead>
                    <TableHead>{view.columns.date}</TableHead>
                    <TableHead>{view.columns.total}</TableHead>
                    <TableHead>{view.columns.state}</TableHead>
                    <TableHead>{view.columns.seller}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.sales.map((sale) => (
                    <TableRow key={sale.number}>
                      <TableCell className="font-mono text-xs">{sale.number}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatLocalDateTime(sale.createdAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatMoney(sale.totalCents)}
                      </TableCell>
                      <TableCell>{view.saleStatus[sale.status]}</TableCell>
                      <TableCell>{sale.sellerName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>

          <Section title={view.sections.cash}>
            {data.cash.length === 0 ? (
              <p className="text-muted-foreground text-sm">{view.empty}</p>
            ) : (
              <Table data-testid="support-cash">
                <TableCaption className="sr-only">{view.sections.cash}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{view.columns.opened}</TableHead>
                    <TableHead>{view.columns.closed}</TableHead>
                    <TableHead>{view.columns.cashier}</TableHead>
                    <TableHead>{view.columns.state}</TableHead>
                    <TableHead>{view.columns.difference}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.cash.map((row) => (
                    <TableRow key={row.openedAt.toISOString()}>
                      <TableCell className="whitespace-nowrap">
                        {formatLocalDateTime(row.openedAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.closedAt ? formatLocalDateTime(row.closedAt) : view.notClosed}
                      </TableCell>
                      <TableCell>{row.userName}</TableCell>
                      <TableCell>{view.cashStatus[row.status]}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.differenceCents === null ? "—" : formatMoney(row.differenceCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>

          <Section title={view.sections.audit}>
            {data.audit.length === 0 ? (
              <p className="text-muted-foreground text-sm">{view.empty}</p>
            ) : (
              <Table data-testid="support-audit">
                <TableCaption className="sr-only">{view.sections.audit}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{view.columns.date}</TableHead>
                    <TableHead>{view.columns.action}</TableHead>
                    <TableHead>{view.columns.entity}</TableHead>
                    <TableHead>{view.columns.by}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.audit.map((row, index) => (
                    <TableRow key={`${row.createdAt.toISOString()}-${index}`}>
                      <TableCell className="whitespace-nowrap">
                        {formatLocalDateTime(row.createdAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.action}</TableCell>
                      <TableCell>{row.entityType}</TableCell>
                      <TableCell>{row.userName ?? view.system}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
