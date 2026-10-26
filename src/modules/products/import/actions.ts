"use server";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";

import { importProducts, planImport } from "./service";
import { toPreview, type ImportActionState } from "./types";
import type { UploadedFile } from "./table";

async function readUpload(formData: FormData): Promise<UploadedFile | null> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return null;
  }
  return { name: file.name, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) };
}

const noFile: ImportActionState = { error: messages.products.import.problems.fileType };

/** Revisa el archivo y devuelve el resumen y los problemas; no escribe nada. */
export async function previewImportAction(formData: FormData): Promise<ImportActionState> {
  const { user } = await requireUserCapability("product.write");
  const file = await readUpload(formData);
  if (!file) {
    return noFile;
  }
  const result = await toActionResult(() => planImport(user, file), messages.errors);
  return result.ok ? { preview: toPreview(result.data) } : { error: result.error.message };
}

/** Importa el archivo completo en una sola transacción, o devuelve los problemas si hay alguno. */
export async function confirmImportAction(formData: FormData): Promise<ImportActionState> {
  const { user } = await requireUserCapability("product.write");
  const file = await readUpload(formData);
  if (!file) {
    return noFile;
  }
  const result = await toActionResult(() => importProducts(user, file), messages.errors);
  if (!result.ok) {
    return { error: result.error.message };
  }
  return result.data.imported
    ? { done: result.data.imported }
    : { preview: toPreview(result.data.plan) };
}
