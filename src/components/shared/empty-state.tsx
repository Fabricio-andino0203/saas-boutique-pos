import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="border-divider flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      {Icon ? <Icon className="text-muted-foreground size-8" aria-hidden="true" /> : null}
      <h2 className="text-lg font-semibold">{title}</h2>
      {description ? <p className="text-muted-foreground max-w-sm">{description}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
