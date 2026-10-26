import { Skeleton } from "@/components/ui/skeleton";
import { messages } from "@/config/messages.es";

export function ShellFallback() {
  return (
    <div role="status" className="flex min-h-svh">
      <span className="sr-only">{messages.common.loading}</span>
      <div className="border-divider hidden w-64 space-y-3 border-r p-4 md:block">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="flex-1 space-y-4 p-6 md:p-8">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}
