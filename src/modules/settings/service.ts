import type { z } from "zod";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { localDateKey, parseLocalDateKey } from "@/lib/dates";
import { db } from "@/lib/db";
import {
  ActiveRangeExistsError,
  NotFoundError,
  RangeOverlapError,
  ValidationError,
} from "@/lib/errors";
import { processLogo } from "@/lib/images";
import { requireCapability } from "@/lib/permissions";
import {
  getSettings,
  setSetting,
  SETTING_KEYS,
  type SettingKey,
  type SettingsSnapshot,
} from "@/lib/settings";
import type { Actor } from "@/modules/catalog/service";
import { businessSchema, fiscalRangeSchema, settingsPatchSchema } from "@/modules/settings/schemas";

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? "Invalid input");
  }
  return result.data;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// ───────────────────────── Negocio ─────────────────────────

export type BusinessValues = {
  legalName: string;
  tradeName: string;
  taxId: string;
  address: string;
  phone: string;
};

export async function getBusinessProfile(
  client: Pick<PrismaClient, "businessProfile"> = db,
): Promise<BusinessValues> {
  const profile = await client.businessProfile.findFirst({ orderBy: { createdAt: "asc" } });
  return {
    legalName: profile?.legalName ?? "",
    tradeName: profile?.tradeName ?? "",
    taxId: profile?.taxId ?? "",
    address: profile?.address ?? "",
    phone: profile?.phone ?? "",
  };
}

/** El logo del negocio como `data:` URI, o `null` si no hay. Aparte de `getBusinessProfile`: pesa, y solo lo pide el ticket. */
export async function getBusinessLogo(
  client: Pick<PrismaClient, "businessProfile"> = db,
): Promise<string | null> {
  const profile = await client.businessProfile.findFirst({
    orderBy: { createdAt: "asc" },
    select: { logoUrl: true },
  });
  return profile?.logoUrl ?? null;
}

/**
 * Pone el logo del negocio (ya reducido a gris y a lo que cabe en el ticket) o lo quita con `null`. Deja constancia en la
 * auditoría sin guardar la imagen en ella. Necesita que los datos del negocio ya existan.
 */
export async function setBusinessLogo(
  actor: Actor,
  bytes: Uint8Array | null,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "settings.manage");
  const logo = bytes === null ? null : await processLogo(bytes);
  await client.$transaction(async (tx) => {
    const current = await tx.businessProfile.findFirst({ orderBy: { createdAt: "asc" } });
    if (!current) {
      throw new ValidationError("Save the business data before adding a logo");
    }
    await tx.businessProfile.update({
      where: { id: current.id },
      data: { logoUrl: logo?.dataUri ?? null },
    });
    await audit.log(tx, {
      userId: actor.id,
      action: "SETTINGS_CHANGED",
      entityType: "BusinessProfile",
      entityId: current.id,
      before: { logo: current.logoUrl ? "set" : "none" },
      after: logo
        ? { logo: "set", width: logo.width, height: logo.height, bytes: logo.bytes }
        : { logo: "removed" },
    });
  });
}

export async function updateBusinessProfile(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "settings.manage");
  const data = parseInput(businessSchema, input);
  const next = {
    legalName: data.legalName,
    tradeName: data.tradeName ?? null,
    taxId: data.taxId ?? null,
    address: data.address ?? null,
    phone: data.phone ?? null,
  };
  await client.$transaction(async (tx) => {
    const current = await tx.businessProfile.findFirst({ orderBy: { createdAt: "asc" } });
    if (current) {
      await tx.businessProfile.update({ where: { id: current.id }, data: next });
    } else {
      await tx.businessProfile.create({ data: next });
    }
    const before = {
      legalName: current?.legalName ?? null,
      tradeName: current?.tradeName ?? null,
      taxId: current?.taxId ?? null,
      address: current?.address ?? null,
      phone: current?.phone ?? null,
    };
    if (!same(before, next)) {
      await audit.log(tx, {
        userId: actor.id,
        action: "SETTINGS_CHANGED",
        entityType: "BusinessProfile",
        entityId: current?.id ?? "new",
        before,
        after: next,
      });
    }
  });
}

// ───────────────────────── Ajustes ─────────────────────────

export async function getSettingsSnapshot(
  client: Pick<PrismaClient, "setting"> = db,
): Promise<SettingsSnapshot> {
  return getSettings(client);
}

/** Guarda solo las claves recibidas y deja en auditoría lo que cambió de verdad. */
export async function updateSettings(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<{ changed: SettingKey[] }> {
  requireCapability(actor, "settings.manage");
  const patch = parseInput(settingsPatchSchema, input) as Partial<Record<SettingKey, unknown>>;
  return client.$transaction(async (tx) => {
    const current = await getSettings(tx);
    const changed = SETTING_KEYS.filter((key) => key in patch && !same(patch[key], current[key]));
    for (const key of changed) {
      await setSetting(tx, key, patch[key] as never);
    }
    if (changed.length > 0) {
      await audit.log(tx, {
        userId: actor.id,
        action: "SETTINGS_CHANGED",
        entityType: "Setting",
        entityId: changed.join(","),
        before: Object.fromEntries(
          changed.map((key) => [key, current[key]]),
        ) as Prisma.InputJsonObject,
        after: Object.fromEntries(
          changed.map((key) => [key, patch[key]]),
        ) as Prisma.InputJsonObject,
      });
    }
    return { changed };
  });
}

// ───────────────────────── Rangos CAI ─────────────────────────

export type FiscalRangeRow = {
  id: string;
  documentType: "INVOICE" | "CREDIT_NOTE";
  terminalName: string;
  cai: string;
  prefix: string;
  rangeStart: number;
  rangeEnd: number;
  nextNumber: number;
  expiresAt: string;
  isActive: boolean;
  expired: boolean;
};

export async function listFiscalRanges(
  client: Pick<PrismaClient, "fiscalRange"> = db,
  now: Date = new Date(),
): Promise<FiscalRangeRow[]> {
  const rows = await client.fiscalRange.findMany({
    include: { terminal: { select: { name: true } } },
    orderBy: [{ isActive: "desc" }, { expiresAt: "desc" }],
  });
  const today = localDateKey(now);
  return rows.map((row) => {
    const expiresAt = localDateKey(row.expiresAt);
    return {
      id: row.id,
      documentType: row.documentType,
      terminalName: row.terminal?.name ?? "",
      cai: row.cai,
      prefix: row.prefix,
      rangeStart: row.rangeStart,
      rangeEnd: row.rangeEnd,
      nextNumber: row.nextNumber,
      expiresAt,
      isActive: row.isActive,
      expired: expiresAt < today,
    };
  });
}

export async function listTerminals(
  client: Pick<PrismaClient, "terminal"> = db,
): Promise<{ value: string; label: string }[]> {
  const terminals = await client.terminal.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  return terminals.map((terminal) => ({ value: terminal.id, label: terminal.name }));
}

async function assertNoActiveRange(
  tx: Prisma.TransactionClient,
  documentType: "INVOICE" | "CREDIT_NOTE",
  terminalId: string | null,
  exceptId?: string,
): Promise<void> {
  const other = await tx.fiscalRange.findFirst({
    where: {
      documentType,
      terminalId,
      isActive: true,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (other) {
    throw new ActiveRangeExistsError();
  }
}

export async function createFiscalRange(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<{ id: string }> {
  requireCapability(actor, "settings.manage");
  const data = parseInput(fiscalRangeSchema, input);
  return client.$transaction(async (tx) => {
    const terminal = data.terminalId
      ? await tx.terminal.findUnique({ where: { id: data.terminalId } })
      : await tx.terminal.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
    if (!terminal) {
      throw new ValidationError("Unknown terminal");
    }

    const overlapping = await tx.fiscalRange.findFirst({
      where: {
        documentType: data.documentType,
        prefix: data.prefix,
        rangeStart: { lte: data.rangeEnd },
        rangeEnd: { gte: data.rangeStart },
      },
      select: { id: true },
    });
    if (overlapping) {
      throw new RangeOverlapError();
    }
    await assertNoActiveRange(tx, data.documentType, terminal.id);

    const created = await tx.fiscalRange.create({
      data: {
        documentType: data.documentType,
        terminalId: terminal.id,
        cai: data.cai,
        prefix: data.prefix,
        rangeStart: data.rangeStart,
        rangeEnd: data.rangeEnd,
        nextNumber: data.rangeStart,
        expiresAt: parseLocalDateKey(data.expiresAt) as Date,
        isActive: true,
      },
    });
    await audit.log(tx, {
      userId: actor.id,
      action: "FISCAL_RANGE_CHANGED",
      entityType: "FiscalRange",
      entityId: created.id,
      after: {
        documentType: data.documentType,
        cai: data.cai,
        prefix: data.prefix,
        rangeStart: data.rangeStart,
        rangeEnd: data.rangeEnd,
        expiresAt: data.expiresAt,
        isActive: true,
      },
    });
    return { id: created.id };
  });
}

export async function setFiscalRangeActive(
  actor: Actor,
  id: string,
  active: boolean,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "settings.manage");
  await client.$transaction(async (tx) => {
    const range = await tx.fiscalRange.findUnique({ where: { id } });
    if (!range) {
      throw new NotFoundError();
    }
    if (active && !range.isActive) {
      await assertNoActiveRange(tx, range.documentType, range.terminalId, id);
    }
    if (range.isActive !== active) {
      await tx.fiscalRange.update({ where: { id }, data: { isActive: active } });
      await audit.log(tx, {
        userId: actor.id,
        action: "FISCAL_RANGE_CHANGED",
        entityType: "FiscalRange",
        entityId: id,
        before: { isActive: range.isActive },
        after: { isActive: active },
      });
    }
  });
}
