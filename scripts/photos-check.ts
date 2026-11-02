import "dotenv/config";

import { randomUUID } from "node:crypto";

import { photoStore, photoStoreDescription } from "../src/modules/photos/storage";

/**
 * Comprueba de verdad el almacén de fotos de esta instalación: guarda un archivo de prueba, lo lee, lo borra y comprueba que
 * ya no está. Sirve después de configurar el bucket (S3_*) o la carpeta (UPLOADS_DIR), y para saber que las credenciales
 * funcionan sin tener que subir una foto desde una pantalla.
 *
 *   pnpm photos:check
 *
 * El archivo vive en `check/<id>/` y siempre se intenta borrar, aunque algo falle a mitad. Sale con 1 si algo no cuadra.
 */

async function main(): Promise<void> {
  const store = photoStore();
  console.log(`Almacén: ${photoStoreDescription()}`);

  const key = `check/${randomUUID().replaceAll("-", "")}/prueba.webp`;
  const bytes = Buffer.from(`prueba ${new Date().toISOString()}`);
  let failed = false;
  try {
    await store.put(key, bytes);
    console.log("✔ guardó el archivo");

    const read = await store.get(key);
    if (!read || !read.equals(bytes)) {
      throw new Error("lo que se leyó no es lo que se guardó");
    }
    console.log("✔ lo leyó igual que se guardó");
  } catch (error) {
    failed = true;
    console.error("✘", error instanceof Error ? error.message : error);
  } finally {
    try {
      await store.remove([key]);
      if ((await store.get(key)) !== null) {
        throw new Error("el archivo sigue ahí después de borrarlo");
      }
      console.log("✔ lo borró y ya no está");
    } catch (error) {
      failed = true;
      console.error("✘", error instanceof Error ? error.message : error);
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
