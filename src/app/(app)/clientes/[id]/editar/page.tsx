import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { CustomerForm } from "@/modules/customers/components/customer-form";
import { getCustomerForEdit } from "@/modules/customers/queries";

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageCapability("customer.write");
  const { id } = await params;
  const customer = await getCustomerForEdit(id);
  if (!customer) {
    notFound();
  }
  return (
    <div className="space-y-6">
      <PageHeader title={`${messages.customers.form.editTitle}: ${customer.name}`} />
      <CustomerForm initial={customer} />
    </div>
  );
}
