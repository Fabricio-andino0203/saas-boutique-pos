import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { requireSession } from "@/lib/auth";
import { hasCapability } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/modules/settings/service";

export default async function HomePage() {
  const { user } = await requireSession();
  const needsSetup =
    hasCapability(user.role, "settings.manage") &&
    !(await getSettingsSnapshot())["onboarding.completed"];
  const banner = messages.settings.onboarding;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{messages.home.title}</h1>
        <p className="text-muted-foreground">{messages.home.description}</p>
      </div>
      {needsSetup ? (
        <section
          aria-labelledby="setup-title"
          className="bg-muted/50 flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
        >
          <div className="space-y-1">
            <h2 id="setup-title" className="font-medium">
              {banner.banner}
            </h2>
            <p className="text-muted-foreground text-sm">{banner.bannerHint}</p>
          </div>
          <Link href="/bienvenida" className={buttonVariants()}>
            {banner.bannerAction}
          </Link>
        </section>
      ) : null}
    </div>
  );
}
