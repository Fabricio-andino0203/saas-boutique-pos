import { messages } from "@/config/messages.es";
import type { CashSessionStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

const STYLE: Record<CashSessionStatus, string> = {
  OPEN: "bg-info/15 text-info",
  CLOSED_PENDING_APPROVAL: "bg-warning/15 text-warning",
  CLOSED: "bg-success/15 text-success",
};

export function CashStatusBadge({ status }: { status: CashSessionStatus }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", STYLE[status])}>
      {messages.cash.status[status]}
    </span>
  );
}
