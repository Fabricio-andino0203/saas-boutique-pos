import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { getTerminalStatus } from "@/modules/cash/queries";
import { PosScreen } from "@/modules/sales/components/pos-screen";
import { listPosCategories } from "@/modules/sales/pos-queries";
import type { PosConfig } from "@/modules/sales/pos-types";

export default async function PosPage() {
  const { user } = await requirePageCapability("sale.create");
  const terminal = await getTerminalStatus();

  // Sin turno abierto en la terminal no se vende: una pantalla amable y el camino para abrirlo.
  if (!terminal.openBy) {
    const copy = messages.pos.closed;
    return (
      <div className="mx-auto max-w-lg space-y-4 py-12 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-muted-foreground">{copy.description}</p>
        {hasCapability(user.role, "cash.open") ? (
          <Link href="/caja" className={buttonVariants()}>
            {copy.action}
          </Link>
        ) : null}
      </div>
    );
  }

  const [settings, categories] = await Promise.all([getSettings(db), listPosCategories()]);
  const config: PosConfig = {
    terminalName: terminal.terminalName,
    openedByName: terminal.openBy,
    taxRateBps: settings["tax.rate"],
    pricesIncludeTax: settings["tax.pricesIncludeTax"],
    allowNegativeStock: settings["sales.allowNegativeStock"],
    cashierDiscountPercent: settings["discount.maxPercent.CASHIER"],
    canDiscountBeyondLimit: hasCapability(user.role, "discount.applyBeyondLimit"),
  };
  return <PosScreen config={config} categories={categories} />;
}
