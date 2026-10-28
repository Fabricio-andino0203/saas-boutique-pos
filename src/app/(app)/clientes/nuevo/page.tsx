import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { CustomerForm } from "@/modules/customers/components/customer-form";

export default async function NewCustomerPage() {
  await requirePageCapability("customer.write");
  return (
    <div className="space-y-6">
      <PageHeader title={messages.customers.form.createTitle} />
      <CustomerForm />
    </div>
  );
}
