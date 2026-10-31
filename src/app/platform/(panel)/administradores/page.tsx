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
import { AdminRowActions } from "@/modules/platform/components/admin-row-actions";
import { CreateAdminForm } from "@/modules/platform/components/create-admin-form";
import { listPlatformUsers } from "@/modules/platform/service";

const copy = platformMessages.admins;

export default async function PlatformAdminsPage() {
  const session = await requirePlatformSession();
  const users = await listPlatformUsers();
  const now = new Date();

  return (
    <div className="space-y-10">
      <PageHeader title={copy.title} description={copy.description} />

      <Table>
        <TableCaption className="sr-only">{copy.title}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{copy.columns.name}</TableHead>
            <TableHead>{copy.columns.username}</TableHead>
            <TableHead>{copy.columns.twoFactor}</TableHead>
            <TableHead>{copy.columns.lastLogin}</TableHead>
            <TableHead>{copy.columns.status}</TableHead>
            <TableHead>{copy.columns.actions}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const isSelf = user.id === session.user.id;
            const isLocked = user.lockedUntil !== null && user.lockedUntil > now;
            const status = !user.isActive
              ? copy.status.inactive
              : isLocked
                ? copy.status.locked
                : copy.status.active;
            return (
              <TableRow key={user.id}>
                <TableCell className="font-medium">
                  {user.name}{" "}
                  {isSelf ? <span className="text-muted-foreground">{copy.you}</span> : null}
                </TableCell>
                <TableCell>@{user.username}</TableCell>
                <TableCell>
                  {user.twoFactorEnabled ? copy.twoFactor.on : copy.twoFactor.off}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {user.lastLoginAt ? formatLocalDateTime(user.lastLoginAt) : copy.never}
                </TableCell>
                <TableCell>{status}</TableCell>
                <TableCell>
                  {isSelf ? null : (
                    <AdminRowActions
                      userId={user.id}
                      isActive={user.isActive}
                      isLocked={isLocked}
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{copy.create.title}</h2>
          <p className="text-muted-foreground text-sm">{copy.create.description}</p>
        </div>
        <CreateAdminForm />
      </section>
    </div>
  );
}
