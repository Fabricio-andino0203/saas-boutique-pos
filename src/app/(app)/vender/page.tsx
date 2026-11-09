import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { OpenCashForm } from "@/modules/cash/components/open-cash-form";
import { getOpenSessionOf, getTerminalStatus } from "@/modules/cash/queries";
import { getInvoicingState } from "@/modules/fiscal/alerts";
import { PosScreen } from "@/modules/sales/components/pos-screen";
import { listPosCategories } from "@/modules/sales/pos-queries";
import type { PosConfig } from "@/modules/sales/pos-types";

export default async function PosPage() {
  const { user } = await requirePageCapability("sale.create");
  const terminal = await getTerminalStatus();

  // Sin turno abierto en la terminal no se vende: se abre aquí mismo, con el fondo que dejó el último cierre.
  if (!terminal.openBy) {
    const copy = messages.pos.closed;
    const canOpen = hasCapability(user.role, "cash.open");
    return (
      <div className="mx-auto max-w-lg space-y-6 py-12">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="text-muted-foreground text-sm">{terminal.terminalName}</p>
        </div>
        {canOpen ? (
          <OpenCashForm
            inherited={
              terminal.inherited
                ? {
                    cents: terminal.inherited.cents,
                    closedAt: terminal.inherited.closedAt.toISOString(),
                    closedByName: terminal.inherited.closedByName,
                  }
                : null
            }
          />
        ) : null}
        <p className="text-center">
          <Link href="/caja/cierres" className={buttonVariants({ variant: "outline" })}>
            {messages.nav.cashClosings}
          </Link>
        </p>
      </div>
    );
  }

  const canUseCash = hasCapability(user.role, "cash.open");
  const ownsCash = canUseCash ? (await getOpenSessionOf(user.id)) !== null : false;

  const [settings, categories, invoicing] = await Promise.all([
    getSettings(db),
    listPosCategories(),
    getInvoicingState(terminal.terminalId),
  ]);
  const config: PosConfig = {
    terminalName: terminal.terminalName,
    openedByName: terminal.openBy,
    taxRateBps: settings["tax.rate"],
    pricesIncludeTax: settings["tax.pricesIncludeTax"],
    allowNegativeStock: settings["sales.allowNegativeStock"],
    invoicing,
    enabledPaymentMethods: settings["payments.enabled"],
    cashierDiscountPercent: settings["discount.maxPercent.CASHIER"],
    canDiscountBeyondLimit: hasCapability(user.role, "discount.applyBeyondLimit"),
    layaway: {
      minDepositPercent: settings["layaway.minDepositPercent"],
      expiryDays: settings["layaway.expiryDays"],
    },
    canLayaway: hasCapability(user.role, "layaway.manage"),
    canUseCash,
    ownsCash,
  };
  return <PosScreen config={config} categories={categories} />;
}
