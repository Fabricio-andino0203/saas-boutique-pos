import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Dónde viven los archivos que no son datos (las fotos de los productos). Un almacén guarda bytes bajo una **clave**
 * (`negocio/producto/foto/medium.webp`); hoy es una carpeta del servidor (un volumen en Docker/Railway) y mañana puede ser
 * un servicio de objetos (R2/S3) sin tocar a quien lo usa.
 *
 * La clave nunca viene de lo que escribe una persona: la arma el servidor con ids propios. Aun así se valida aquí, para que
 * un error de programación no pueda salirse de la carpeta (`..`, rutas absolutas, `\`, unidades de Windows).
 */
export type BlobStore = {
  put(key: string, data: Uint8Array): Promise<void>;
  /** Los bytes, o `null` si no existe (por ejemplo, tras restaurar una base sin sus archivos). */
  get(key: string): Promise<Buffer | null>;
  /** Borra sin quejarse de lo que ya no está. */
  remove(keys: readonly string[]): Promise<void>;
};

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const MAX_SEGMENTS = 6;

/** Las partes de la clave, o lanza si no es una clave segura. */
export function parseBlobKey(key: string): string[] {
  const segments = key.split("/");
  if (
    segments.length > MAX_SEGMENTS ||
    segments.some((segment) => !SEGMENT.test(segment) || segment.includes(".."))
  ) {
    throw new Error("Invalid blob key");
  }
  return segments;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/** Un almacén en una carpeta. Escribe a un archivo temporal y lo renombra: nadie lee jamás un archivo a medias. */
export function createFileStore(root: string): BlobStore {
  const base = path.resolve(root);

  function locate(key: string): string {
    const file = path.join(base, ...parseBlobKey(key));
    if (!file.startsWith(base + path.sep)) {
      throw new Error("Invalid blob key");
    }
    return file;
  }

  return {
    async put(key, data) {
      const file = locate(key);
      await mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        await writeFile(temporary, data);
        await rename(temporary, file);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    },

    async get(key) {
      try {
        return await readFile(locate(key));
      } catch (error) {
        if (isMissing(error)) {
          return null;
        }
        throw error;
      }
    },

    async remove(keys) {
      const folders = new Set<string>();
      for (const key of keys) {
        const file = locate(key);
        await rm(file, { force: true });
        folders.add(path.dirname(file));
      }
      // Las carpetas vacías no se acumulan; si todavía tienen algo, rmdir se niega y se deja.
      for (const folder of folders) {
        try {
          await rmdir(folder);
        } catch {
          // no vacía o ya no existe: nada que limpiar
        }
      }
    },
  };
}
