import { Building2 } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
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
import { requirePlatformSession } from "@/lib/platform-auth";
import { CreateTenantForm } from "@/modules/platform/components/create-tenant-form";
import { provisioningAvailable } from "@/modules/platform/provisioning";
import { listTenants } from "@/modules/platform/queries";

const copy = platformMessages.tenants;

export default async function PlatformTenantsPage() {
  await requirePlatformSession();
  const tenants = await listTenants();
  const baseDomain = process.env.TENANT_BASE_DOMAIN;

  return (
    <div className="space-y-10">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Link href="/negocios/revision" className="text-primary text-sm underline">
            {copy.viewReview}
          </Link>
        }
      />

      <section aria-labelledby="create-tenant-title" className="space-y-3">
        <h2 id="create-tenant-title" className="text-lg font-semibold">
          {copy.create.title}
        </h2>
        {provisioningAvailable() ? (
          <>
            <p className="text-muted-foreground max-w-3xl text-sm">{copy.create.description}</p>
            <CreateTenantForm baseDomain={baseDomain} />
          </>
        ) : (
          <p role="status" className="text-muted-foreground text-sm">
            {copy.create.unavailable}
          </p>
        )}
      </section>

      {tenants.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={copy.empty.title}
          description={copy.empty.description}
        />
      ) : (
        <Table>
          <TableCaption className="sr-only">{copy.title}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.columns.name}</TableHead>
              <TableHead>{copy.columns.address}</TableHead>
              <TableHead>{copy.columns.status}</TableHead>
              <TableHead>{copy.columns.schema}</TableHead>
              <TableHead>{copy.columns.created}</TableHead>
              <TableHead>
                <span className="sr-only">{copy.open}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.map((tenant) => (
              <TableRow key={tenant.id}>
                <TableCell className="font-medium">
                  {tenant.name}
                  {tenant.canary ? (
                    <span className="text-muted-foreground ml-2 text-xs">({copy.canaryBadge})</span>
                  ) : null}
                </TableCell>
                <TableCell>{baseDomain ? `${tenant.slug}.${baseDomain}` : tenant.slug}</TableCell>
                <TableCell>{copy.status[tenant.status]}</TableCell>
                <TableCell className="font-mono text-xs">
                  {tenant.schemaVersion ?? copy.noSchema}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatLocalDateTime(tenant.createdAt)}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/negocios/${tenant.slug}`}
                    className="text-primary text-sm underline"
                    aria-label={`${copy.open} ${tenant.name}`}
                  >
                    {copy.open}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
