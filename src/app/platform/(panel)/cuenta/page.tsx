import { PageHeader } from "@/components/shared/page-header";
import { platformMessages } from "@/config/messages.platform.es";
import { requirePlatformSession } from "@/lib/platform-auth";
import { PlatformChangePasswordForm } from "@/modules/platform/components/change-password-form";

const copy = platformMessages.account;

export default async function PlatformAccountPage() {
  await requirePlatformSession();

  return (
    <div className="space-y-6">
      <PageHeader title={copy.title} description={copy.description} />
      <PlatformChangePasswordForm />
    </div>
  );
}
