import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { hasCapability } from "@/lib/permissions";
import { CategoryManager } from "@/modules/finance/components/category-manager";
import { listFinanceCategories } from "@/modules/finance/queries";

const copy = messages.finance.categories;

export default async function FinanceCategoriesPage() {
  const { user } = await requirePageCapability("finance.view");
  const categories = await listFinanceCategories({ includeArchived: true });
  const canWrite = hasCapability(user.role, "finance.write");

  return (
    <div className="space-y-6">
      <PageHeader title={copy.title} description={copy.description} />
      {canWrite ? (
        <CategoryManager categories={categories} />
      ) : (
        <ul className="divide-divider bg-card divide-y rounded-lg border">
          {categories
            .filter((category) => !category.archived)
            .map((category) => (
              <li key={category.id} className="flex justify-between gap-3 p-3">
                <span>{category.name}</span>
                <span className="text-muted-foreground text-sm">
                  {messages.finance.typesPlural[category.type]}
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
