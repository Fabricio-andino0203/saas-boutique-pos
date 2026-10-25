import { Skeleton } from "@/components/ui/skeleton";
import { messages } from "@/config/messages.es";

export default function Loading() {
  return (
    <div role="status" className="mx-auto w-full max-w-3xl space-y-4 p-6 md:p-8">
      <span className="sr-only">{messages.common.loading}</span>
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
