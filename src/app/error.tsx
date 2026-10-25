"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { messages } from "@/config/messages.es";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto max-w-md space-y-3 p-8 text-center">
      <h2 className="text-xl font-semibold">{messages.states.error.title}</h2>
      <p className="text-muted-foreground">{messages.states.error.description}</p>
      <Button onClick={() => retry()}>{messages.common.retry}</Button>
    </div>
  );
}
