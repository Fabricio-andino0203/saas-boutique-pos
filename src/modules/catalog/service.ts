import type { z } from "zod";

import { messages } from "@/config/messages.es";
import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { localDateKey, parseLocalDateKey } from "@/lib/dates";
import { ItemInUseError, NameTakenError, NotFoundError, ValidationError } from "@/lib/errors";
import { requireCapability, type Role } from "@/lib/permissions";
import { slugify } from "@/lib/slug";
import {
  CATALOG_CONFIG,
  type CatalogEntity,
  type ItemRow,
  type SelectOption,
} from "@/modules/catalog/config";
import { catalogSchemas, type CatalogInput } from "@/modules/catalog/schemas";

export type Actor = { id: string; role: Role };

type Adapter = {
  list(client: PrismaClient): Promise<ItemRow[]>;
  get(client: PrismaClient, id: string): Promise<ItemRow | null>;
  create(client: PrismaClient, input: unknown): Promise<void>;
  update(client: PrismaClient, id: string, input: unknown): Promise<void>;
  setArchived(client: PrismaClient, id: string, archived: boolean): Promise<void>;
  /** Cuántos elementos activos siguen usando este registro. */
  usage(client: PrismaClient, id: string): Promise<number>;
};

function parse<E extends CatalogEntity>(entity: E, input: unknown): CatalogInput<E> {
  const result = (catalogSchemas[entity] as z.ZodType).safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? "Invalid input");
  }
  return result.data as CatalogInput<E>;
}

function dbErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function mapDbError(error: unknown): unknown {
  switch (dbErrorCode(error)) {
    case "P2002":
      return new NameTakenError();
    case "P2025":
      return new NotFoundError();
    default:
      return error;
  }
}

const archivedAt = (archived: boolean): Date | null => (archived ? new Date() : null);
const day = (date: Date | null): string => (date ? localDateKey(date) : "");
const orNull = <T>(value: T | undefined): T | null => value ?? null;

const ADAPTERS: Record<CatalogEntity, Adapter> = {
  brands: {
    list: async (c) =>
      (await c.brand.findMany({ orderBy: { name: "asc" } })).map((b) => ({
        id: b.id,
        archived: b.archivedAt !== null,
        values: { name: b.name },
      })),
    get: async (c, id) => {
      const b = await c.brand.findUnique({ where: { id } });
      return b ? { id: b.id, archived: b.archivedAt !== null, values: { name: b.name } } : null;
    },
    create: async (c, input) => {
      await c.brand.create({ data: { name: parse("brands", input).name } });
    },
    update: async (c, id, input) => {
      await c.brand.update({ where: { id }, data: { name: parse("brands", input).name } });
    },
    setArchived: async (c, id, archived) => {
      await c.brand.update({ where: { id }, data: { archivedAt: archivedAt(archived) } });
    },
    usage: (c, id) => c.product.count({ where: { brandId: id, archivedAt: null } }),
  },

  seasons: {
    list: async (c) =>
      (await c.season.findMany({ orderBy: [{ startsAt: "desc" }, { name: "asc" }] })).map((s) => ({
        id: s.id,
        archived: s.archivedAt !== null,
        values: { name: s.name, startsAt: day(s.startsAt), endsAt: day(s.endsAt) },
      })),
    get: async (c, id) => {
      const s = await c.season.findUnique({ where: { id } });
      return s
        ? {
            id: s.id,
            archived: s.archivedAt !== null,
            values: { name: s.name, startsAt: day(s.startsAt), endsAt: day(s.endsAt) },
          }
        : null;
    },
    create: async (c, input) => {
      const d = parse("seasons", input);
      await c.season.create({
        data: {
          name: d.name,
          startsAt: d.startsAt ? parseLocalDateKey(d.startsAt) : null,
          endsAt: d.endsAt ? parseLocalDateKey(d.endsAt) : null,
        },
      });
    },
    update: async (c, id, input) => {
      const d = parse("seasons", input);
      await c.season.update({
        where: { id },
        data: {
          name: d.name,
          startsAt: d.startsAt ? parseLocalDateKey(d.startsAt) : null,
          endsAt: d.endsAt ? parseLocalDateKey(d.endsAt) : null,
        },
      });
    },
    setArchived: async (c, id, archived) => {
      await c.season.update({ where: { id }, data: { archivedAt: archivedAt(archived) } });
    },
    usage: (c, id) => c.product.count({ where: { seasonId: id, archivedAt: null } }),
  },

  sizes: {
    list: async (c) =>
      (await c.size.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })).map((s) => ({
        id: s.id,
        archived: s.archivedAt !== null,
        values: { name: s.name, group: s.group ?? "", sortOrder: String(s.sortOrder) },
      })),
    get: async (c, id) => {
      const s = await c.size.findUnique({ where: { id } });
      return s
        ? {
            id: s.id,
            archived: s.archivedAt !== null,
            values: { name: s.name, group: s.group ?? "", sortOrder: String(s.sortOrder) },
          }
        : null;
    },
    create: async (c, input) => {
      const d = parse("sizes", input);
      await c.size.create({
        data: { name: d.name, group: orNull(d.group), sortOrder: d.sortOrder },
      });
    },
    update: async (c, id, input) => {
      const d = parse("sizes", input);
      await c.size.update({
        where: { id },
        data: { name: d.name, group: orNull(d.group), sortOrder: d.sortOrder },
      });
    },
    setArchived: async (c, id, archived) => {
      await c.size.update({ where: { id }, data: { archivedAt: archivedAt(archived) } });
    },
    usage: (c, id) => c.variant.count({ where: { sizeId: id, archivedAt: null } }),
  },

  colors: {
    list: async (c) =>
      (await c.color.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })).map((x) => ({
        id: x.id,
        archived: x.archivedAt !== null,
        values: { name: x.name, hex: x.hex ?? "", sortOrder: String(x.sortOrder) },
      })),
    get: async (c, id) => {
      const x = await c.color.findUnique({ where: { id } });
      return x
        ? {
            id: x.id,
            archived: x.archivedAt !== null,
            values: { name: x.name, hex: x.hex ?? "", sortOrder: String(x.sortOrder) },
          }
        : null;
    },
    create: async (c, input) => {
      const d = parse("colors", input);
      await c.color.create({ data: { name: d.name, hex: orNull(d.hex), sortOrder: d.sortOrder } });
    },
    update: async (c, id, input) => {
      const d = parse("colors", input);
      await c.color.update({
        where: { id },
        data: { name: d.name, hex: orNull(d.hex), sortOrder: d.sortOrder },
      });
    },
    setArchived: async (c, id, archived) => {
      await c.color.update({ where: { id }, data: { archivedAt: archivedAt(archived) } });
    },
    usage: (c, id) => c.variant.count({ where: { colorId: id, archivedAt: null } }),
  },

  suppliers: {
    list: async (c) =>
      (await c.supplier.findMany({ orderBy: { name: "asc" } })).map((s) => ({
        id: s.id,
        archived: s.archivedAt !== null,
        values: supplierValues(s),
      })),
    get: async (c, id) => {
      const s = await c.supplier.findUnique({ where: { id } });
      return s ? { id: s.id, archived: s.archivedAt !== null, values: supplierValues(s) } : null;
    },
    create: async (c, input) => {
      const d = parse("suppliers", input);
      await c.supplier.create({ data: supplierData(d) });
    },
    update: async (c, id, input) => {
      const d = parse("suppliers", input);
      await c.supplier.update({ where: { id }, data: supplierData(d) });
    },
    setArchived: async (c, id, archived) => {
      await c.supplier.update({ where: { id }, data: { archivedAt: archivedAt(archived) } });
    },
    usage: (c, id) => c.product.count({ where: { defaultSupplierId: id, archivedAt: null } }),
  },

  categories: {
    list: async (c) => {
      const all = await c.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
      const names = new Map(all.map((cat) => [cat.id, cat.name]));
      const ordered: typeof all = [];
      const visit = (parentId: string | null) => {
        for (const cat of all.filter((candidate) => candidate.parentId === parentId)) {
          ordered.push(cat);
          visit(cat.id);
        }
      };
      visit(null);
      return ordered.map((cat) => ({
        id: cat.id,
        archived: cat.archivedAt !== null,
        values: {
          name: cat.name,
          parent: cat.parentId ? (names.get(cat.parentId) ?? "") : "",
          parentId: cat.parentId ?? "",
          sortOrder: String(cat.sortOrder),
          allowsReturns: cat.allowsReturns ? "true" : "",
        },
      }));
    },
    get: async (c, id) => {
      const cat = await c.category.findUnique({ where: { id } });
      if (!cat) {
        return null;
      }
      return {
        id: cat.id,
        archived: cat.archivedAt !== null,
        values: {
          name: cat.name,
          parentId: cat.parentId ?? "",
          sortOrder: String(cat.sortOrder),
          allowsReturns: cat.allowsReturns ? "true" : "",
        },
      };
    },
    create: async (c, input) => {
      const d = parse("categories", input);
      const parent = d.parentId ? await c.category.findUnique({ where: { id: d.parentId } }) : null;
      if (d.parentId && !parent) {
        throw new ValidationError("Unknown parent category");
      }
      const slug = slugify(parent ? `${parent.slug}-${d.name}` : d.name);
      if (!slug) {
        throw new ValidationError("Invalid name");
      }
      await c.category.create({
        data: {
          name: d.name,
          slug,
          parentId: orNull(d.parentId),
          sortOrder: d.sortOrder,
          allowsReturns: d.allowsReturns,
        },
      });
    },
    update: async (c, id, input) => {
      const d = parse("categories", input);
      if (d.parentId) {
        const all = await c.category.findMany({ select: { id: true, parentId: true } });
        if (d.parentId === id || descendantsOf(all, id).has(d.parentId)) {
          throw new ValidationError("A category cannot be inside itself");
        }
      }
      await c.category.update({
        where: { id },
        data: {
          name: d.name,
          parentId: orNull(d.parentId),
          sortOrder: d.sortOrder,
          allowsReturns: d.allowsReturns,
        },
      });
    },
    setArchived: async (c, id, archived) => {
      await c.category.update({ where: { id }, data: { archivedAt: archivedAt(archived) } });
    },
    usage: async (c, id) =>
      (await c.product.count({ where: { categoryId: id, archivedAt: null } })) +
      (await c.category.count({ where: { parentId: id, archivedAt: null } })),
  },
};

type SupplierRecord = {
  name: string;
  taxId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  paymentTerms: string | null;
  notes: string | null;
};

function supplierValues(s: SupplierRecord): Record<string, string> {
  return {
    name: s.name,
    taxId: s.taxId ?? "",
    contactName: s.contactName ?? "",
    phone: s.phone ?? "",
    email: s.email ?? "",
    address: s.address ?? "",
    paymentTerms: s.paymentTerms ?? "",
    notes: s.notes ?? "",
  };
}

function supplierData(d: CatalogInput<"suppliers">) {
  return {
    name: d.name,
    taxId: orNull(d.taxId),
    contactName: orNull(d.contactName),
    phone: orNull(d.phone),
    email: orNull(d.email),
    address: orNull(d.address),
    paymentTerms: orNull(d.paymentTerms),
    notes: orNull(d.notes),
  };
}

export function descendantsOf(
  all: { id: string; parentId: string | null }[],
  rootId: string,
): Set<string> {
  const found = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const cat of all) {
      if (cat.parentId === current && !found.has(cat.id)) {
        found.add(cat.id);
        stack.push(cat.id);
      }
    }
  }
  return found;
}

export async function listItems(entity: CatalogEntity, client: PrismaClient = db) {
  return ADAPTERS[entity].list(client);
}

export async function getItem(entity: CatalogEntity, id: string, client: PrismaClient = db) {
  return ADAPTERS[entity].get(client, id);
}

/** Opciones de los campos de tipo selección. Para categorías: las activas, sin la propia ni sus hijas. */
export async function getFieldOptions(
  entity: CatalogEntity,
  excludeId?: string,
  client: PrismaClient = db,
): Promise<Record<string, SelectOption[]>> {
  if (entity !== "categories") {
    return {};
  }
  const all = await client.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, parentId: true, archivedAt: true },
  });
  const blocked = excludeId ? descendantsOf(all, excludeId).add(excludeId) : new Set<string>();
  const names = new Map(all.map((cat) => [cat.id, cat]));
  const path = (id: string): string => {
    const cat = names.get(id);
    return cat ? (cat.parentId ? `${path(cat.parentId)} › ${cat.name}` : cat.name) : "";
  };
  return {
    parentId: [
      { value: "", label: messages.catalog.noParent },
      ...all
        .filter((cat) => cat.archivedAt === null && !blocked.has(cat.id))
        .map((cat) => ({ value: cat.id, label: path(cat.id) }))
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    ],
  };
}

export async function createItem(
  actor: Actor,
  entity: CatalogEntity,
  input: unknown,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, CATALOG_CONFIG[entity].capability);
  try {
    await ADAPTERS[entity].create(client, input);
  } catch (error) {
    throw mapDbError(error);
  }
}

export async function updateItem(
  actor: Actor,
  entity: CatalogEntity,
  id: string,
  input: unknown,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, CATALOG_CONFIG[entity].capability);
  try {
    await ADAPTERS[entity].update(client, id, input);
  } catch (error) {
    throw mapDbError(error);
  }
}

/** Archiva o restaura. No se archiva algo que todavía usan productos, variantes o categorías activas. */
export async function setItemArchived(
  actor: Actor,
  entity: CatalogEntity,
  id: string,
  archived: boolean,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, CATALOG_CONFIG[entity].capability);
  const adapter = ADAPTERS[entity];
  if (!(await adapter.get(client, id))) {
    throw new NotFoundError();
  }
  if (archived && (await adapter.usage(client, id)) > 0) {
    throw new ItemInUseError();
  }
  try {
    await adapter.setArchived(client, id, archived);
  } catch (error) {
    throw mapDbError(error);
  }
}
