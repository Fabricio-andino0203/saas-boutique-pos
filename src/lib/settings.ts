import { z } from "zod";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/**
 * Ajustes tipados (clave/valor en la tabla `Setting`). Cada clave tiene su validación y su valor por
 * defecto: si la fila no existe, o su contenido no es válido, se usa el valor por defecto.
 */
export const PAYMENT_METHODS = ["CASH", "CARD", "TRANSFER", "OTHER"] as const;
export type ConfigurablePaymentMethod = (typeof PAYMENT_METHODS)[number];

export const SETTING_DEFS = {
  /** Puntos base: 1500 = 15 %. */
  "tax.rate": { schema: z.number().int().min(0).max(5000), default: 1500 },
  "tax.pricesIncludeTax": { schema: z.boolean(), default: true },
  "sales.allowNegativeStock": { schema: z.boolean(), default: false },
  "discount.maxPercent.CASHIER": { schema: z.number().int().min(0).max(100), default: 10 },
  "returns.maxDays": { schema: z.number().int().min(0).max(365), default: 8 },
  "layaway.expiryDays": { schema: z.number().int().min(1).max(365), default: 30 },
  "ticket.footer": { schema: z.string().max(200), default: "¡Gracias por tu compra!" },
  /** El crédito de tienda siempre está activo: nace de devoluciones y apartados. */
  "payments.enabled": {
    schema: z.array(z.enum(PAYMENT_METHODS)).min(1),
    default: [...PAYMENT_METHODS] as ConfigurablePaymentMethod[],
  },
  "barcode.internalPrefix": { schema: z.string().regex(/^\d{1,6}$/), default: "200" },
  "onboarding.completed": { schema: z.boolean(), default: false },
} as const;

export type SettingKey = keyof typeof SETTING_DEFS;
export type SettingValue<K extends SettingKey> = z.output<(typeof SETTING_DEFS)[K]["schema"]>;
export type SettingsSnapshot = { [K in SettingKey]: SettingValue<K> };
export type SettingsPatch = Partial<SettingsSnapshot>;

export const SETTING_KEYS = Object.keys(SETTING_DEFS) as SettingKey[];

type Reader = Pick<PrismaClient, "setting">;

function read<K extends SettingKey>(key: K, stored: unknown): SettingValue<K> {
  const def = SETTING_DEFS[key];
  const parsed = (def.schema as z.ZodType).safeParse(stored);
  return (parsed.success ? parsed.data : def.default) as SettingValue<K>;
}

export async function getSetting<K extends SettingKey>(
  client: Reader,
  key: K,
): Promise<SettingValue<K>> {
  const row = await client.setting.findUnique({ where: { key } });
  return read(key, row?.valueJson);
}

export async function getSettings(client: Reader): Promise<SettingsSnapshot> {
  const rows = await client.setting.findMany({ where: { key: { in: SETTING_KEYS } } });
  const stored = new Map(rows.map((row) => [row.key, row.valueJson]));
  return Object.fromEntries(
    SETTING_KEYS.map((key) => [key, read(key, stored.get(key))]),
  ) as SettingsSnapshot;
}

export async function setSetting<K extends SettingKey>(
  client: Reader,
  key: K,
  value: SettingValue<K>,
): Promise<void> {
  const parsed = (SETTING_DEFS[key].schema as z.ZodType).parse(value) as Prisma.InputJsonValue;
  await client.setting.upsert({
    where: { key },
    update: { valueJson: parsed },
    create: { key, valueJson: parsed },
  });
}
