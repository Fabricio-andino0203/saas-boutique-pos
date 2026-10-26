import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { formatLocalDateTime } from "@/lib/dates";
import { UsersTable, type UserRow } from "@/modules/users/components/users-table";
import { listUsers } from "@/modules/users/service";

export default async function UsersPage() {
  await requirePageCapability("user.manage");
  const users = await listUsers();
  const now = new Date();

  const rows: UserRow[] = users.map((user) => ({
    id: user.id,
    name: user.name,
    username: user.username,
    role: messages.auth.roles[user.role],
    status: !user.isActive
      ? messages.users.status.inactive
      : user.lockedUntil && user.lockedUntil > now
        ? messages.users.status.locked
        : messages.users.status.active,
    lastLogin: user.lastLoginAt ? formatLocalDateTime(user.lastLoginAt) : messages.users.never,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={messages.users.title}
        description={messages.users.description}
        actions={
          <Link href="/usuarios/nuevo" className={buttonVariants()}>
            {messages.users.new}
          </Link>
        }
      />
      <UsersTable rows={rows} />
    </div>
  );
}
