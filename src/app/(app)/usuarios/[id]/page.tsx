import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { EditUserForms } from "@/modules/users/components/edit-user-forms";
import { getUser } from "@/modules/users/service";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageCapability("user.manage");
  const { id } = await params;
  const user = await getUser(id);
  if (!user) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <Link href="/usuarios" className="text-muted-foreground text-sm hover:underline">
        {messages.users.back}
      </Link>
      <PageHeader
        title={messages.users.editTitle}
        description={`${user.name} · ${user.username}`}
      />
      <EditUserForms user={user} isSelf={session.user.id === user.id} />
    </div>
  );
}
