import { messages } from "@/config/messages.es";
import type { StockCountStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

const STYLE: Record<StockCountStatus, string> = {
  OPEN: "bg-info/15 text-info",
  IN_REVIEW: "bg-warning/15 text-warning",
  APPLIED: "bg-success/15 text-success",
  CANCELLED: "bg-muted text-muted-foreground",
};

export function CountStatusBadge({ status }: { status: StockCountStatus }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", STYLE[status])}>
      {messages.counts.status[status]}
    </span>
  );
}
