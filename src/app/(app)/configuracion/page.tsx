import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { BusinessForm, SettingsForm } from "@/modules/settings/components/settings-forms";
import { getBusinessProfile, getSettingsSnapshot } from "@/modules/settings/service";

export default async function SettingsPage() {
  await requirePageCapability("settings.manage");
  const [business, settings] = await Promise.all([getBusinessProfile(), getSettingsSnapshot()]);
  const copy = messages.settings;

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Link href="/configuracion/cai" className={buttonVariants({ variant: "outline" })}>
            {copy.fiscal.link}
          </Link>
        }
      />

      <section aria-labelledby="business-title" className="space-y-4">
        <div className="space-y-1">
          <h2 id="business-title" className="text-lg font-medium">
            {copy.business.title}
          </h2>
          <p className="text-muted-foreground text-sm">{copy.business.description}</p>
        </div>
        <BusinessForm values={business} />
      </section>

      <section aria-labelledby="settings-title">
        <h2 id="settings-title" className="sr-only">
          {copy.region}
        </h2>
        <SettingsForm groups={["tax", "payments", "rules", "codes"]} values={settings} />
      </section>
    </div>
  );
}
