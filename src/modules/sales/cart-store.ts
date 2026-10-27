"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  addToCart,
  removeItem,
  setItemDiscount,
  setQuantity,
  type CartItem,
  type NewCartItem,
  type StockRule,
} from "@/modules/sales/cart-logic";
import type { QuickCustomer } from "@/modules/sales/pos-types";
import type { Discount } from "@/modules/sales/schemas";

export type ParkedCart = {
  id: string;
  createdAt: number;
  items: CartItem[];
  discount?: Discount;
  customer: QuickCustomer | null;
};

const MAX_PARKED = 20;

/** `crypto.randomUUID` solo existe en contextos seguros (https o localhost): en una red local con http se usa un respaldo. */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

type PosState = {
  items: CartItem[];
  discount: Discount | undefined;
  customer: QuickCustomer | null;
  /** Se genera una vez por ticket: reintentar el cobro con él no duplica la venta. */
  clientRequestId: string;
  selectedId: string | null;
  /** Ventas en espera de este navegador (por terminal, hoy hay una sola). */
  parked: ParkedCart[];
  hydrated: boolean;

  addItem: (incoming: Omit<NewCartItem, "id">, rule: StockRule) => { capped: boolean };
  changeQuantity: (id: string, quantity: number, rule: StockRule) => { capped: boolean };
  removeLine: (id: string) => void;
  setLineDiscount: (id: string, discount: Discount | undefined) => void;
  setDiscount: (discount: Discount | undefined) => void;
  setCustomer: (customer: QuickCustomer | null) => void;
  select: (id: string | null) => void;
  /** Vacía el ticket (después de cobrar o descartar) y le da un identificador nuevo. */
  clearCart: () => void;
  parkCart: () => boolean;
  resumeParked: (id: string) => boolean;
  discardParked: (id: string) => void;
};

const emptyCart = () => ({
  items: [] as CartItem[],
  discount: undefined,
  customer: null,
  selectedId: null,
  clientRequestId: newId(),
});

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      ...emptyCart(),
      parked: [],
      hydrated: false,

      addItem: (incoming, rule) => {
        const change = addToCart(get().items, { ...incoming, id: newId() }, rule);
        set({ items: change.items, selectedId: change.touchedId ?? get().selectedId });
        return { capped: change.capped };
      },
      changeQuantity: (id, quantity, rule) => {
        const change = setQuantity(get().items, id, quantity, rule);
        const stillThere = change.items.some((item) => item.id === get().selectedId);
        set({ items: change.items, selectedId: stillThere ? get().selectedId : null });
        return { capped: change.capped };
      },
      removeLine: (id) =>
        set((state) => ({
          items: removeItem(state.items, id),
          selectedId: state.selectedId === id ? null : state.selectedId,
        })),
      setLineDiscount: (id, discount) =>
        set((state) => ({ items: setItemDiscount(state.items, id, discount) })),
      setDiscount: (discount) => set({ discount }),
      setCustomer: (customer) => set({ customer }),
      select: (selectedId) => set({ selectedId }),
      clearCart: () => set(emptyCart()),

      parkCart: () => {
        const { items, discount, customer, parked } = get();
        if (items.length === 0) {
          return false;
        }
        const entry: ParkedCart = { id: newId(), createdAt: Date.now(), items, discount, customer };
        set({ ...emptyCart(), parked: [entry, ...parked].slice(0, MAX_PARKED) });
        return true;
      },
      resumeParked: (id) => {
        const { parked, items, discount, customer } = get();
        const chosen = parked.find((entry) => entry.id === id);
        if (!chosen) {
          return false;
        }
        // Lo que estaba armado no se pierde: pasa a la lista de espera.
        const rest = parked.filter((entry) => entry.id !== id);
        const current: ParkedCart[] =
          items.length > 0
            ? [{ id: newId(), createdAt: Date.now(), items, discount, customer }]
            : [];
        set({
          items: chosen.items,
          discount: chosen.discount,
          customer: chosen.customer,
          selectedId: null,
          clientRequestId: newId(),
          parked: [...current, ...rest].slice(0, MAX_PARKED),
        });
        return true;
      },
      discardParked: (id) =>
        set((state) => ({ parked: state.parked.filter((entry) => entry.id !== id) })),
    }),
    {
      name: "boutique-pos-cart-v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // La lectura del navegador se hace después de montar (la página se genera en el servidor sin él).
      skipHydration: true,
      partialize: (state) => ({
        items: state.items,
        discount: state.discount,
        customer: state.customer,
        clientRequestId: state.clientRequestId,
        parked: state.parked,
      }),
    },
  ),
);

/** Lee el ticket guardado en este navegador; llamar una vez al montar la pantalla de venta. */
export async function hydratePosStore(): Promise<void> {
  try {
    await usePosStore.persist.rehydrate();
  } catch {
    // Sin almacenamiento (modo privado, bloqueado): el ticket vive solo en memoria.
  }
  usePosStore.setState({ hydrated: true });
}
