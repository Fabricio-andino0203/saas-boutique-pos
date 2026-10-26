import { messages } from "@/config/messages.es";
import type { Capability } from "@/lib/permissions";

export const CATALOG_ENTITIES = [
  "categories",
  "brands",
  "seasons",
  "sizes",
  "colors",
  "suppliers",
] as const;

export type CatalogEntity = (typeof CATALOG_ENTITIES)[number];

export function isCatalogEntity(value: string): value is CatalogEntity {
  return (CATALOG_ENTITIES as readonly string[]).includes(value);
}

export type ItemRow = { id: string; archived: boolean; values: Record<string, string> };
export type SelectOption = { value: string; label: string };

export type FieldType = "text" | "number" | "color" | "date" | "select" | "checkbox";

export type FieldDef = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  hint?: string;
};

export type CatalogConfig = {
  capability: Capability;
  fields: FieldDef[];
  /** Claves de `values` que se muestran como columnas de la tabla. */
  columns: string[];
};

const f = messages.catalog.fields;
const h = messages.catalog.hints;

export const CATALOG_CONFIG: Record<CatalogEntity, CatalogConfig> = {
  categories: {
    capability: "product.write",
    fields: [
      { name: "name", label: f.name, type: "text", required: true },
      { name: "parentId", label: f.parentId, type: "select", hint: h.parentId },
      { name: "sortOrder", label: f.sortOrder, type: "number", hint: h.sortOrder },
      { name: "allowsReturns", label: f.allowsReturns, type: "checkbox", hint: h.allowsReturns },
    ],
    columns: ["name", "parent"],
  },
  brands: {
    capability: "product.write",
    fields: [{ name: "name", label: f.name, type: "text", required: true }],
    columns: ["name"],
  },
  seasons: {
    capability: "product.write",
    fields: [
      { name: "name", label: f.name, type: "text", required: true },
      { name: "startsAt", label: f.startsAt, type: "date" },
      { name: "endsAt", label: f.endsAt, type: "date" },
    ],
    columns: ["name", "startsAt", "endsAt"],
  },
  sizes: {
    capability: "product.write",
    fields: [
      { name: "name", label: f.name, type: "text", required: true },
      { name: "group", label: f.group, type: "text", hint: h.group },
      { name: "sortOrder", label: f.sortOrder, type: "number", hint: h.sortOrder },
    ],
    columns: ["name", "group", "sortOrder"],
  },
  colors: {
    capability: "product.write",
    fields: [
      { name: "name", label: f.name, type: "text", required: true },
      { name: "hex", label: f.hex, type: "color", hint: h.hex },
      { name: "sortOrder", label: f.sortOrder, type: "number", hint: h.sortOrder },
    ],
    columns: ["name", "hex", "sortOrder"],
  },
  suppliers: {
    capability: "purchase.receive",
    fields: [
      { name: "name", label: f.name, type: "text", required: true },
      { name: "taxId", label: f.taxId, type: "text" },
      { name: "contactName", label: f.contactName, type: "text" },
      { name: "phone", label: f.phone, type: "text" },
      { name: "email", label: f.email, type: "text" },
      { name: "address", label: f.address, type: "text" },
      { name: "paymentTerms", label: f.paymentTerms, type: "text" },
      { name: "notes", label: f.notes, type: "text" },
    ],
    columns: ["name", "contactName", "phone"],
  },
};

/** Etiqueta de una columna de tabla: las derivadas (como `parent`) también tienen texto. */
export function columnLabel(key: string): string {
  return (f as Record<string, string>)[key] ?? key;
}
