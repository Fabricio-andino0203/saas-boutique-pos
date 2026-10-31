import type { PrismaClient } from "../../src/generated/prisma/client";
import { hashSecret } from "../../src/lib/password";

/** Credenciales de demostración: solo para desarrollo. Rotar antes de producción (§20.1). */
export const DEMO_USERS = [
  {
    username: "owner",
    name: "Propietario Demo",
    role: "OWNER",
    password: "Demo-Propietario-2026",
    pin: "1111",
  },
  {
    username: "manager",
    name: "Gerente Demo",
    role: "MANAGER",
    password: "Demo-Gerente-2026",
    pin: "2222",
  },
  {
    username: "cashier",
    name: "Cajero Demo",
    role: "CASHIER",
    password: "Demo-Cajero-2026",
    pin: "3333",
  },
  {
    username: "warehouse",
    name: "Almacén Demo",
    role: "WAREHOUSE",
    password: "Demo-Almacen-2026",
    pin: "4444",
  },
] as const;

const CLOTHING_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const SHOE_SIZES = ["34", "35", "36", "37", "38", "39", "40", "41", "42"];

const COLORS = [
  ["Negro", "#1A1A1A"],
  ["Blanco", "#FFFFFF"],
  ["Gris", "#8A8A8A"],
  ["Beige", "#D9C7A7"],
  ["Café", "#6B4423"],
  ["Rojo", "#B42318"],
  ["Rosa", "#E58EA7"],
  ["Azul marino", "#1F2A5C"],
  ["Azul", "#2F6DB5"],
  ["Verde", "#3F7F4F"],
  ["Amarillo", "#E8C547"],
  ["Morado", "#6B3FA0"],
] as const;

// Padres primero: un hijo necesita el id de su padre.
const CATEGORIES = [
  { slug: "mujer", name: "Mujer", parent: null },
  { slug: "mujer-vestidos", name: "Vestidos", parent: "mujer" },
  { slug: "mujer-blusas", name: "Blusas", parent: "mujer" },
  { slug: "hombre", name: "Hombre", parent: null },
  { slug: "hombre-camisas", name: "Camisas", parent: "hombre" },
  { slug: "ninos", name: "Niños", parent: null },
  { slug: "accesorios", name: "Accesorios", parent: null },
  { slug: "calzado", name: "Calzado", parent: null },
] as const;

const DEFAULT_SETTINGS = [
  ["tax.rate", 1500],
  ["tax.pricesIncludeTax", true],
  ["sales.allowNegativeStock", false],
  ["discount.maxPercent.CASHIER", 10],
  ["returns.maxDays", 8],
  ["layaway.expiryDays", 30],
  ["ticket.footer", "¡Gracias por tu compra!"],
] as const;

const DOCUMENT_COUNTERS = ["SALE", "RETURN", "LAYAWAY", "PURCHASE_ORDER", "GOODS_RECEIPT"] as const;

/** Falla si la base es de producción: los usuarios de demostración nunca deben existir allí. */
export function assertNotProduction(what: string): void {
  if (process.env.NODE_ENV === "production" || process.env.DEPLOYMENT === "production") {
    throw new Error(`${what} no se ejecuta en producción (NODE_ENV o DEPLOYMENT = production)`);
  }
}

/** Datos que toda instalación necesita (ubicación, caja, catálogos base, ajustes, contadores). Idempotente. */
export async function seedBase(client: PrismaClient): Promise<void> {
  const location = await client.location.upsert({
    where: { code: "MAIN" },
    update: {},
    create: { code: "MAIN", name: "Tienda principal", isDefault: true, type: "STORE" },
  });

  const terminal = await client.terminal.findFirst({
    where: { name: "Caja 1", locationId: location.id },
  });
  if (!terminal) {
    await client.terminal.create({ data: { name: "Caja 1", locationId: location.id } });
  }

  const sizes = [
    ...CLOTHING_SIZES.map((name, index) => ({ name, group: "ropa", sortOrder: index + 1 })),
    ...SHOE_SIZES.map((name, index) => ({ name, group: "calzado", sortOrder: index + 10 })),
  ];
  for (const size of sizes) {
    await client.size.upsert({
      where: { name: size.name },
      update: { group: size.group, sortOrder: size.sortOrder },
      create: size,
    });
  }

  for (const [index, [name, hex]] of COLORS.entries()) {
    await client.color.upsert({
      where: { name },
      update: { hex, sortOrder: index + 1 },
      create: { name, hex, sortOrder: index + 1 },
    });
  }

  const categoryIds = new Map<string, string>();
  for (const [index, category] of CATEGORIES.entries()) {
    const parentId = category.parent ? (categoryIds.get(category.parent) ?? null) : null;
    const saved = await client.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name, parentId, sortOrder: index },
      create: { slug: category.slug, name: category.name, parentId, sortOrder: index },
    });
    categoryIds.set(category.slug, saved.id);
  }

  if ((await client.businessProfile.count()) === 0) {
    await client.businessProfile.create({ data: { legalName: "Mi Boutique (por configurar)" } });
  }

  for (const [key, value] of DEFAULT_SETTINGS) {
    await client.setting.upsert({
      where: { key },
      update: {},
      create: { key, valueJson: value },
    });
  }

  for (const key of DOCUMENT_COUNTERS) {
    await client.documentCounter.upsert({
      where: { key },
      update: {},
      create: { key, nextValue: 1 },
    });
  }
}

async function seedDemoUsers(client: PrismaClient): Promise<number> {
  for (const demo of DEMO_USERS) {
    const existing = await client.user.findUnique({ where: { username: demo.username } });
    if (existing) {
      await client.user.update({
        where: { username: demo.username },
        data: { name: demo.name, role: demo.role },
      });
    } else {
      await client.user.create({
        data: {
          username: demo.username,
          name: demo.name,
          role: demo.role,
          passwordHash: await hashSecret(demo.password),
          pinHash: await hashSecret(demo.pin),
        },
      });
    }
  }
  return DEMO_USERS.length;
}

/** Siembra de desarrollo: la base más los usuarios de demostración. Nunca reinicia contadores ni rehashea usuarios existentes. */
export async function runSeed(client: PrismaClient): Promise<{ users: number }> {
  assertNotProduction("La semilla de demostración");
  await seedBase(client);
  return { users: await seedDemoUsers(client) };
}
