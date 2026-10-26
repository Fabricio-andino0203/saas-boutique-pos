"use client";

import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { messages } from "@/config/messages.es";
import { cellKey } from "@/modules/products/sku";

import type { PickerItem } from "./option-picker";

const copy = messages.products.wizard;

type QuantityGridProps = {
  sizes: PickerItem[];
  colors: PickerItem[];
  quantities: Record<string, number>;
  onChange: (quantities: Record<string, number>) => void;
  /** Combinaciones que ya existen: no se pueden cargar aquí. */
  existing?: Set<string>;
};

/** Cuadrícula talla × color para escribir cuántas hay de cada una. */
export function QuantityGrid({ sizes, colors, quantities, onChange, existing }: QuantityGridProps) {
  const rows: (PickerItem | null)[] = sizes.length > 0 ? sizes : [null];
  const columns: (PickerItem | null)[] = colors.length > 0 ? colors : [null];

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{copy.sizes}</TableHead>
          {columns.map((color) => (
            <TableHead key={color?.id ?? "-"}>{color?.name ?? copy.single}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((size) => (
          <TableRow key={size?.id ?? "-"}>
            <TableCell className="font-medium">{size?.name ?? copy.single}</TableCell>
            {columns.map((color) => {
              const key = cellKey(size?.id ?? null, color?.id ?? null);
              const label = [size?.name, color?.name].filter(Boolean).join(" · ") || copy.single;
              return (
                <TableCell key={key}>
                  {existing?.has(key) ? (
                    <span className="text-muted-foreground text-sm">—</span>
                  ) : (
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      aria-label={`${copy.quantity}: ${label}`}
                      className="w-20 text-right tabular-nums"
                      value={quantities[key] ?? 0}
                      onChange={(event) => {
                        const parsed = Math.trunc(Number(event.target.value));
                        onChange({
                          ...quantities,
                          [key]: Number.isFinite(parsed) && parsed > 0 ? parsed : 0,
                        });
                      }}
                    />
                  )}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
