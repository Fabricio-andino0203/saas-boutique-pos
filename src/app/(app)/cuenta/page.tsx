import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { ChangePasswordForm } from "@/modules/auth/components/change-password-form";

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageHeader
        title={messages.auth.account.title}
        description={messages.auth.account.description}
      />
      <ChangePasswordForm />
    </div>
  );
}
