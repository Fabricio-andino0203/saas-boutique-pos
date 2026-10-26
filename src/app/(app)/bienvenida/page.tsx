import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { OnboardingWizard } from "@/modules/settings/components/onboarding-wizard";
import { hasSampleData } from "@/modules/settings/sample-data";
import { getBusinessProfile, getSettingsSnapshot } from "@/modules/settings/service";

export default async function OnboardingPage() {
  await requirePageCapability("settings.manage");
  const [business, settings, sampleLoaded] = await Promise.all([
    getBusinessProfile(),
    getSettingsSnapshot(),
    hasSampleData(),
  ]);
  const copy = messages.settings.onboarding;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={copy.title} description={copy.description} />
      <OnboardingWizard business={business} settings={settings} sampleLoaded={sampleLoaded} />
    </div>
  );
}
