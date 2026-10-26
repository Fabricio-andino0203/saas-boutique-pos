"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { scanCountAction, type ScanState } from "@/modules/inventory/count-actions";

const copy = messages.counts.scanner;

/** Un pitido corto y una vibración: confirman la lectura sin mirar la pantalla. */
function feedback(ok: boolean): void {
  try {
    navigator.vibrate?.(ok ? 40 : [60, 40, 60]);
    const Context = window.AudioContext;
    const context = new Context();
    const oscillator = context.createOscillator();
    oscillator.frequency.value = ok ? 880 : 220;
    oscillator.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.08);
    oscillator.onended = () => void context.close();
  } catch {
    // Sin sonido ni vibración: no pasa nada.
  }
}

type CountScannerProps = { countId: string; items: number; counted: number };

/**
 * Modo escáner: la última prenda leída se ve grande, con su contador y el avance. Las lecturas rápidas
 * se atienden en orden, una tras otra.
 */
export function CountScanner({ countId, items, counted }: CountScannerProps) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const refresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [code, setCode] = useState("");
  const [last, setLast] = useState<Extract<ScanState, { status: "ok" }>["item"] | null>(null);
  const [touched, setTouched] = useState(counted);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  function scan(value: string, delta: 1 | -1) {
    queue.current = queue.current.then(async () => {
      const result = await scanCountAction(countId, value, delta);
      if (result.status === "ok") {
        setLast(result.item);
        setMessage(null);
        setTouched((current) =>
          result.item.becameCounted
            ? current + 1
            : delta === -1 && result.item.countedQty === 0
              ? Math.max(0, current - 1)
              : current,
        );
        feedback(true);
      } else {
        setMessage(result.message);
        feedback(false);
      }
      if (refresh.current) {
        clearTimeout(refresh.current);
      }
      refresh.current = setTimeout(() => router.refresh(), 600);
    });
  }

  function submit() {
    const value = code.trim();
    if (value === "") {
      return;
    }
    setCode("");
    scan(value, 1);
    input.current?.focus();
  }

  const percent = items === 0 ? 0 : Math.round((touched / items) * 100);

  return (
    <section aria-labelledby="scanner-title" className="bg-card space-y-4 rounded-lg border p-4">
      <h2 id="scanner-title" className="text-lg font-medium">
        {copy.title}
      </h2>
      <div className="flex max-w-xl gap-2">
        <Input
          ref={input}
          aria-label={copy.label}
          placeholder={copy.placeholder}
          autoComplete="off"
          className="h-12 text-lg"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
      </div>
      {message ? (
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      ) : null}

      <div aria-live="polite" className="bg-muted/50 space-y-1 rounded-lg p-4">
        <p className="text-muted-foreground text-sm">{copy.last}</p>
        {last ? (
          <>
            <p className="text-2xl font-semibold">
              {last.productName}
              {last.label ? ` · ${last.label}` : ""}
            </p>
            <p className="text-4xl font-bold tabular-nums">
              {last.countedQty}{" "}
              <span className="text-muted-foreground text-base font-normal">{copy.counted}</span>
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                scan(last.sku, -1);
                input.current?.focus();
              }}
            >
              {copy.undo}
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground">{copy.none}</p>
        )}
      </div>

      <div className="space-y-1">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={items}
          aria-valuenow={touched}
          aria-label={copy.progress}
          className="bg-muted h-2 overflow-hidden rounded-full"
        >
          <div className="bg-primary h-full" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-muted-foreground text-sm tabular-nums">
          {touched} {copy.of} {items} {copy.progress}
        </p>
      </div>
    </section>
  );
}
