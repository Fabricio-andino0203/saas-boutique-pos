import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { FiscalRangeForm, FiscalRangeTable } from "@/modules/settings/components/fiscal-ranges";
import { listFiscalRanges, listTerminals } from "@/modules/settings/service";

export default async function FiscalRangesPage() {
  await requirePageCapability("settings.manage");
  const [ranges, terminals] = await Promise.all([listFiscalRanges(), listTerminals()]);
  const copy = messages.settings.fiscal;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <Link href="/configuracion" className="text-muted-foreground text-sm hover:underline">
        {copy.back}
      </Link>
      <PageHeader title={copy.title} description={copy.description} />
      <FiscalRangeTable ranges={ranges} />
      <FiscalRangeForm terminals={terminals} />
    </div>
  );
}
