import { messages } from "@/config/messages.es";
import type { PurchaseOrderStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

const STYLE: Record<PurchaseOrderStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  ORDERED: "bg-info/15 text-info",
  PARTIALLY_RECEIVED: "bg-warning/15 text-warning",
  RECEIVED: "bg-success/15 text-success",
  CANCELLED: "bg-destructive/10 text-destructive",
};

export function OrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", STYLE[status])}>
      {messages.purchasing.status[status]}
    </span>
  );
}
