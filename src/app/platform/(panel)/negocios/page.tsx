import { Building2 } from "lucide-react";

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
import { listTenants } from "@/modules/platform/queries";

const copy = platformMessages.tenants;

export default async function PlatformTenantsPage() {
  await requirePlatformSession();
  const tenants = await listTenants();

  return (
    <div className="space-y-6">
      <PageHeader title={copy.title} description={copy.description} />
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
              <TableHead>{copy.columns.slug}</TableHead>
              <TableHead>{copy.columns.status}</TableHead>
              <TableHead>{copy.columns.created}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.map((tenant) => (
              <TableRow key={tenant.id}>
                <TableCell className="font-medium">{tenant.name}</TableCell>
                <TableCell>{tenant.slug}</TableCell>
                <TableCell>{copy.status[tenant.status]}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatLocalDateTime(tenant.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
