"use client";

import { Keyboard, Pause, Search, UserRoundCog } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { labelOfVariant, summarizeCart } from "@/modules/sales/cart-logic";
import { hydratePosStore, usePosStore } from "@/modules/sales/cart-store";
import { ChargeDialog } from "@/modules/sales/components/charge-dialog";
import { DiscountDialog } from "@/modules/sales/components/discount-dialog";
import {
  CustomerDialog,
  ParkedDialog,
  ShortcutsDialog,
} from "@/modules/sales/components/pos-dialogs";
import { SwitchCashierDialog } from "@/modules/sales/components/switch-cashier-dialog";
import { TicketPanel } from "@/modules/sales/components/ticket-panel";
import { VariantPicker } from "@/modules/sales/components/variant-picker";
import { lookupCodeAction, searchPosAction } from "@/modules/sales/pos-actions";
import type {
  PosCategory,
  PosConfig,
  SellableProduct,
  SellableVariant,
} from "@/modules/sales/pos-types";
import type { Discount } from "@/modules/sales/schemas";

const copy = messages.pos;

type DialogName = "discount" | "customer" | "parked" | "help" | "charge" | "switch";
type Notice = { tone: "ok" | "warn"; text: string };

/** Las dos primeras palabras con peso: "Blusa de lino" es BL, no BD. */
const SMALL_WORDS = new Set(["de", "del", "la", "el", "los", "las", "y", "con", "para"]);

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => word !== "" && !SMALL_WORDS.has(word.toLowerCase()))
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

const isTyping = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  return (
    element !== null &&
    (element.tagName === "INPUT" ||
      element.tagName === "TEXTAREA" ||
      element.tagName === "SELECT" ||
      element.isContentEditable)
  );
};

/** La pantalla de venta: búsqueda y escáner a la izquierda, el ticket a la derecha. Todo con teclado. */
export function PosScreen({
  config,
  categories,
}: {
  config: PosConfig;
  categories: PosCategory[];
}) {
  const items = usePosStore((state) => state.items);
  const discount = usePosStore((state) => state.discount);
  const customer = usePosStore((state) => state.customer);
  const selectedId = usePosStore((state) => state.selectedId);
  const parked = usePosStore((state) => state.parked);

  const rule = useMemo(
    () => ({ allowNegativeStock: config.allowNegativeStock }),
    [config.allowNegativeStock],
  );
  const summary = useMemo(() => summarizeCart(items, discount, config), [items, discount, config]);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [products, setProducts] = useState<SellableProduct[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [picker, setPicker] = useState<SellableProduct | null>(null);
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const focusSearch = useCallback(() => {
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  useEffect(() => {
    void hydratePosStore();
    focusSearch();
  }, [focusSearch]);

  // Los avisos se van solos.
  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Búsqueda mientras se escribe (con una pausa corta para no consultar en cada tecla).
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        setSearching(true);
        const result = await searchPosAction({ q: query, categoryId });
        if (cancelled) {
          return;
        }
        setSearching(false);
        if ("error" in result) {
          setSearchError(result.error);
        } else {
          setSearchError(null);
          setProducts(result.products);
        }
      },
      query.trim() === "" ? 0 : 250,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, categoryId]);

  const addVariant = useCallback(
    (productName: string, variant: SellableVariant) => {
      const label = labelOfVariant(variant);
      const { capped } = usePosStore.getState().addItem(
        {
          variantId: variant.variantId,
          productName,
          variantLabel: label,
          sku: variant.sku,
          unitPriceCents: variant.priceCents,
          maxStock: variant.onHand,
          taxExempt: variant.taxExempt,
        },
        rule,
      );
      if (capped) {
        setNotice({
          tone: "warn",
          text:
            variant.onHand <= 0
              ? copy.notices.outOfStock
              : `${copy.notices.capped} ${Math.max(0, variant.onHand)}.`,
        });
      } else {
        setNotice({
          tone: "ok",
          text: `${copy.notices.added} ${productName}${label ? ` · ${label}` : ""}`,
        });
      }
      setPicker(null);
      setQuery("");
      focusSearch();
    },
    [rule, focusSearch],
  );

  const pickProduct = useCallback(
    (product: SellableProduct) => {
      const [only] = product.variants;
      if (product.variants.length === 1 && only) {
        addVariant(product.name, only);
      } else {
        setPicker(product);
      }
    },
    [addVariant],
  );

  /** Un código exacto (escáner o escrito). Devuelve `false` si no era ningún código. */
  const runLookup = useCallback(
    async (term: string): Promise<boolean> => {
      const result = await lookupCodeAction(term);
      if ("error" in result) {
        setNotice({ tone: "warn", text: result.error });
        return true;
      }
      if (result.kind === "variant") {
        addVariant(result.productName, result.variant);
        return true;
      }
      if (result.kind === "product") {
        setPicker(result.product);
        return true;
      }
      return false;
    },
    [addVariant],
  );

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    const term = query.trim();
    if (term === "") {
      return;
    }
    if (await runLookup(term)) {
      return;
    }
    // Texto libre: si la búsqueda dejó una sola prenda, entra; si no dejó ninguna, se avisa.
    const list = products ?? [];
    const [only] = list;
    if (list.length === 1 && only) {
      pickProduct(only);
    } else if (list.length === 0) {
      setNotice({ tone: "warn", text: copy.notices.notFound });
    }
  }

  const openDialog = (name: DialogName) => setDialog(name);
  const closeDialog = useCallback(() => {
    setDialog(null);
    focusSearch();
  }, [focusSearch]);

  const park = () => {
    const done = usePosStore.getState().parkCart();
    setNotice({
      tone: done ? "ok" : "warn",
      text: done ? copy.parked.parkedNow : copy.parked.nothingToPark,
    });
    if (done) {
      setDialog(null);
      focusSearch();
    }
  };

  const charge = () => {
    if (summary.priced) {
      setDialog("charge");
    }
  };

  /** Reimprime el último ticket cobrado en este navegador, en otra pestaña. */
  const reprint = () => {
    const id = usePosStore.getState().lastSaleId;
    if (id) {
      window.open(`/imprimir/ticket/${id}?auto=1`, "_blank", "noopener");
    } else {
      setNotice({ tone: "warn", text: copy.charge.noReprint });
    }
  };

  const applyDiscount = (scope: "ALL" | "LINE", next: Discount | undefined) => {
    const store = usePosStore.getState();
    if (scope === "LINE" && selected) {
      store.setLineDiscount(selected.id, next);
    } else {
      store.setDiscount(next);
    }
    closeDialog();
  };

  // Atajos de teclado y escáner: los controladores se leen del último render sin volver a registrar el evento.
  const live = useRef({
    openDialog,
    focusSearch,
    charge,
    reprint,
    runLookup,
    selected,
    blocked: false,
  });
  useEffect(() => {
    live.current = {
      openDialog,
      focusSearch,
      charge,
      reprint,
      runLookup,
      selected,
      blocked: dialog !== null || picker !== null,
    };
  });

  useEffect(() => {
    let buffer = "";
    let last = 0;
    function onKeyDown(event: KeyboardEvent) {
      const current = live.current;
      if (current.blocked) {
        return;
      }
      const key = event.key;
      const shortcut = (action: () => void) => {
        event.preventDefault();
        action();
      };
      if (key === "F1") return shortcut(() => current.openDialog("help"));
      if (key === "F2" || ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "k")) {
        return shortcut(current.focusSearch);
      }
      if (key === "F3") return shortcut(() => current.openDialog("customer"));
      if (key === "F4") return shortcut(() => current.openDialog("discount"));
      if (key === "F6") return shortcut(() => current.openDialog("parked"));
      if (key === "F8") {
        return shortcut(() => setNotice({ tone: "warn", text: copy.help.rows[5]?.[1] ?? "" }));
      }
      if (key === "F9") return shortcut(current.reprint);
      if (key === "F12") return shortcut(current.charge);
      if (isTyping(event.target)) {
        return;
      }
      if (key === "Delete" && current.selected) {
        usePosStore.getState().removeLine(current.selected.id);
        return;
      }
      // Escáner con el foco fuera de un campo: llega como ráfaga de teclas rápidas y termina en Enter.
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const now = Date.now();
      if (now - last > 80) {
        buffer = "";
      }
      last = now;
      if (key === "Enter") {
        if (buffer.length >= 4) {
          void current.runLookup(buffer);
        }
        buffer = "";
      } else if (key.length === 1) {
        buffer += key;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const showEmpty = products !== null && products.length === 0 && !searching && !searchError;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="text-muted-foreground text-sm">
            {config.terminalName} · {copy.header.open} ({config.openedByName})
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => openDialog("parked")}>
            <Pause aria-hidden="true" />
            {copy.actions.parked}
            {parked.length > 0 ? (
              <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-xs tabular-nums">
                {parked.length}
              </span>
            ) : null}
            <kbd className="text-muted-foreground text-xs">F6</kbd>
          </Button>
          <Button type="button" variant="outline" onClick={() => openDialog("switch")}>
            <UserRoundCog aria-hidden="true" />
            {copy.switch.button}
          </Button>
          <Button type="button" variant="outline" onClick={() => openDialog("help")}>
            <Keyboard aria-hidden="true" />
            {copy.actions.help} <kbd className="text-muted-foreground text-xs">F1</kbd>
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:h-[calc(100dvh-13rem)] lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-h-0 flex-col gap-3">
          <form onSubmit={submitSearch} role="search" className="relative">
            <Search
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
            />
            <Input
              ref={searchRef}
              aria-label={copy.search.label}
              placeholder={copy.search.placeholder}
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-12 pl-10 text-lg"
            />
          </form>

          {categories.length > 0 ? (
            <div role="group" aria-label={copy.search.categories} className="flex flex-wrap gap-2">
              {[{ id: "", name: copy.search.all }, ...categories].map((category) => (
                <button
                  key={category.id || "all"}
                  type="button"
                  aria-pressed={categoryId === category.id}
                  onClick={() => {
                    setCategoryId(category.id);
                    focusSearch();
                  }}
                  className={cn(
                    "focus-visible:ring-ring/50 min-h-9 rounded-full border px-3.5 text-sm outline-none focus-visible:ring-3",
                    categoryId === category.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  {category.name}
                </button>
              ))}
            </div>
          ) : null}

          <div aria-live="polite" className="min-h-5 text-sm">
            {notice ? (
              <p className={notice.tone === "ok" ? "text-success" : "text-warning"}>
                {notice.text}
              </p>
            ) : null}
          </div>

          <div aria-label={copy.search.results} className="min-h-0 flex-1 overflow-y-auto pr-1">
            {searchError ? (
              <p role="alert" className="text-destructive text-sm">
                {copy.search.error}
              </p>
            ) : products === null ? (
              <p className="text-muted-foreground text-sm">{copy.search.loading}</p>
            ) : showEmpty ? (
              <p className="text-muted-foreground text-sm">
                {query.trim() === "" && categoryId === ""
                  ? copy.search.empty
                  : copy.search.noResults}
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {products.map((product) => {
                  const stock = product.variants.reduce((sum, variant) => sum + variant.onHand, 0);
                  const prices = product.variants.map((variant) => variant.priceCents);
                  const lowest = Math.min(...prices);
                  const varied = lowest !== Math.max(...prices);
                  return (
                    <li key={product.productId}>
                      <button
                        type="button"
                        onClick={() => pickProduct(product)}
                        aria-label={`${product.name}, ${formatMoney(lowest)}`}
                        className={cn(
                          "hover:border-primary focus-visible:ring-ring/50 bg-card flex h-full w-full flex-col gap-1.5 rounded-lg border p-2.5 text-left outline-none focus-visible:ring-3",
                          stock <= 0 && "opacity-60",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className="bg-muted text-muted-foreground grid h-20 place-items-center rounded-md text-2xl font-semibold"
                        >
                          {initialsOf(product.name)}
                        </span>
                        <span className="line-clamp-2 text-sm leading-tight font-medium">
                          {product.name}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {varied ? `${copy.results.from} ` : ""}
                          {formatMoney(lowest)}
                        </span>
                        <span
                          className={cn(
                            "text-xs tabular-nums",
                            stock <= 0 ? "text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {stock <= 0 ? copy.results.out : `${stock} ${copy.results.left}`}
                          {product.variants.length > 1
                            ? ` · ${product.variants.length} ${copy.results.options}`
                            : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <TicketPanel
          items={items}
          summary={summary}
          config={config}
          selectedId={selectedId}
          customer={customer}
          onSelect={(id) => usePosStore.getState().select(id)}
          onQuantity={(id, quantity) => {
            const { capped } = usePosStore.getState().changeQuantity(id, quantity, rule);
            if (capped) {
              setNotice({ tone: "warn", text: copy.notices.outOfStock });
            }
          }}
          onRemove={(id) => usePosStore.getState().removeLine(id)}
          onDiscount={() => openDialog("discount")}
          onCustomer={() => openDialog("customer")}
          onCharge={charge}
          onClear={() => usePosStore.getState().clearCart()}
        />
      </div>

      <VariantPicker
        product={picker}
        allowNegativeStock={config.allowNegativeStock}
        onPick={(variant) => picker && addVariant(picker.name, variant)}
        onClose={() => {
          setPicker(null);
          focusSearch();
        }}
      />
      <DiscountDialog
        open={dialog === "discount"}
        config={config}
        selected={selected}
        saleBaseCents={summary.priced?.subtotalCents ?? 0}
        current={discount}
        onApply={applyDiscount}
        onClose={closeDialog}
      />
      <CustomerDialog
        open={dialog === "customer"}
        current={customer}
        onSelect={(next) => {
          usePosStore.getState().setCustomer(next);
          closeDialog();
        }}
        onClose={closeDialog}
      />
      <ParkedDialog
        open={dialog === "parked"}
        parked={parked}
        hasCurrent={items.length > 0}
        config={config}
        onPark={park}
        onResume={(id) => {
          usePosStore.getState().resumeParked(id);
          closeDialog();
        }}
        onDiscard={(id) => usePosStore.getState().discardParked(id)}
        onClose={closeDialog}
      />
      <ChargeDialog
        open={dialog === "charge"}
        summary={summary}
        config={config}
        onClose={closeDialog}
      />
      <SwitchCashierDialog open={dialog === "switch"} onClose={closeDialog} />
      <ShortcutsDialog open={dialog === "help"} onClose={closeDialog} />
    </div>
  );
}
