import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { CreateUserForm } from "@/modules/users/components/create-user-form";

export default async function NewUserPage() {
  await requirePageCapability("user.manage");

  return (
    <div className="mx-auto max-w-md space-y-6">
      <Link href="/usuarios" className="text-muted-foreground text-sm hover:underline">
        {messages.users.back}
      </Link>
      <PageHeader title={messages.users.createTitle} />
      <CreateUserForm />
    </div>
  );
}
