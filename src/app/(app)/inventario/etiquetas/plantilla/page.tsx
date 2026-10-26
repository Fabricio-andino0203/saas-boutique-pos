import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { LabelTemplateForm } from "@/modules/labels/components/label-template-form";
import { getLabelTemplate } from "@/modules/labels/service";

export default async function LabelTemplatePage() {
  await requirePageCapability("stock.adjust");
  const template = await getLabelTemplate();
  const copy = messages.labels.templateForm;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/inventario/etiquetas" className="text-muted-foreground text-sm hover:underline">
        {copy.back}
      </Link>
      <PageHeader title={copy.title} description={copy.description} />
      <LabelTemplateForm initial={template} />
    </div>
  );
}
