"use client";

import { Button } from "@/components/ui/button";
import { messages } from "@/config/messages.es";

export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      {messages.labels.print.print}
    </Button>
  );
}
