import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { requireSession } from "@/lib/auth";
import { hasCapability } from "@/lib/permissions";
import { listReorderAlerts } from "@/modules/inventory/reorder";
import { getSettingsSnapshot } from "@/modules/settings/service";

export default async function HomePage() {
  const { user } = await requireSession();
  const needsSetup =
    hasCapability(user.role, "settings.manage") &&
    !(await getSettingsSnapshot())["onboarding.completed"];
  const banner = messages.settings.onboarding;
  const alerts = hasCapability(user.role, "stock.adjust") ? await listReorderAlerts() : null;
  const reorder = messages.reorder.card;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{messages.home.title}</h1>
        <p className="text-muted-foreground">{messages.home.description}</p>
      </div>
      {alerts ? (
        <section
          aria-labelledby="reorder-title"
          className="bg-card space-y-3 rounded-lg border p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="reorder-title" className="font-medium">
              {reorder.title}
            </h2>
            <Link
              href="/inventario/reposicion"
              className="text-primary text-sm underline underline-offset-4"
            >
              {reorder.viewAll}
            </Link>
          </div>
          {alerts.length === 0 ? (
            <p className="text-muted-foreground text-sm">{reorder.allGood}</p>
          ) : (
            <>
              <p className="text-sm">
                <span className="text-xl font-semibold tabular-nums">{alerts.length}</span>{" "}
                {reorder.summary}
              </p>
              <ul className="text-muted-foreground space-y-0.5 text-sm">
                {alerts.slice(0, 5).map((alert) => (
                  <li key={alert.variantId}>
                    {[alert.productName, alert.label].filter(Boolean).join(" · ")}:{" "}
                    <span className="text-destructive tabular-nums">{alert.onHand}</span> /{" "}
                    <span className="tabular-nums">{alert.reorderPoint}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : null}
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
