import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md space-y-3 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{messages.states.notFound.title}</h1>
      <p className="text-muted-foreground">{messages.states.notFound.description}</p>
      <Link href="/" className={buttonVariants()}>
        {messages.states.notFound.action}
      </Link>
    </div>
  );
}
