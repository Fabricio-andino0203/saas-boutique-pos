import sharp from "sharp";

import { PHOTO_LIMITS } from "@/config/constants";
import { ImageTooLargeError, InvalidImageError } from "@/lib/errors";

/**
 * Convierte la foto que sube una persona en las tres versiones que usa el sistema (y que usará una tienda en línea):
 * miniatura para tablas y mosaicos, mediana para la ficha y grande para verla de cerca. Todas salen en WebP, orientadas
 * como se ve (no como las guardó el celular) y **sin los datos ocultos** de la cámara (ubicación GPS, modelo, fecha).
 *
 * No se confía en el nombre ni en el tipo que declara el navegador: se mira el contenido. SVG y GIF no se aceptan (un SVG
 * puede llevar código).
 */

/** Lado mayor de cada versión, en píxeles. Nunca se agranda una foto pequeña. */
export const PHOTO_SIZES = { thumb: 200, medium: 720, large: 1600 } as const;
export type PhotoSize = keyof typeof PHOTO_SIZES;
export const PHOTO_SIZE_NAMES = Object.keys(PHOTO_SIZES) as PhotoSize[];

export function isPhotoSize(value: string): value is PhotoSize {
  return (PHOTO_SIZE_NAMES as string[]).includes(value);
}

/** Lo más que se acepta de una foto. Un celular de gama alta da 5–8 MB; el límite de lo que recibe el servidor es 10 MB. */
export const PHOTO_MAX_BYTES = PHOTO_LIMITS.maxBytes;
/** Megapíxeles máximos (un celular de 48 MP cabe). Protege la memoria del servidor contra imágenes diminutas en bytes y enormes al abrirlas. */
export const PHOTO_MAX_PIXELS = 50_000_000;
const WEBP_QUALITY = 80;

export type ImageFormat = "jpeg" | "png" | "webp";

/** El formato real según los primeros bytes, o `null` si no es JPG, PNG ni WebP. */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && pngSignature.every((byte, index) => bytes[index] === byte)) {
    return "png";
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "webp";
  }
  return null;
}

export type PhotoVariant = { data: Buffer; width: number; height: number; bytes: number };

export type ProcessedPhoto = {
  /** Medidas de la versión grande (ya orientada). */
  width: number;
  height: number;
  variants: Record<PhotoSize, PhotoVariant>;
};

export async function processPhoto(input: Uint8Array): Promise<ProcessedPhoto> {
  if (input.byteLength > PHOTO_MAX_BYTES) {
    throw new ImageTooLargeError();
  }
  if (input.byteLength === 0 || !sniffImageFormat(input.subarray(0, 16))) {
    throw new InvalidImageError();
  }

  const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const open = () => sharp(source, { limitInputPixels: PHOTO_MAX_PIXELS, failOn: "error" });

  try {
    const meta = await open().metadata();
    if (!meta.width || !meta.height || meta.width * meta.height > PHOTO_MAX_PIXELS) {
      throw new InvalidImageError();
    }

    const entries = await Promise.all(
      PHOTO_SIZE_NAMES.map(async (name) => {
        const edge = PHOTO_SIZES[name];
        const { data, info } = await open()
          .rotate()
          .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
          .flatten({ background: "#ffffff" })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer({ resolveWithObject: true });
        const variant: PhotoVariant = {
          data,
          width: info.width,
          height: info.height,
          bytes: info.size,
        };
        return [name, variant] as const;
      }),
    );
    const variants = Object.fromEntries(entries) as Record<PhotoSize, PhotoVariant>;
    return { width: variants.large.width, height: variants.large.height, variants };
  } catch (error) {
    throw error instanceof InvalidImageError
      ? error
      : new InvalidImageError("The file could not be read as an image", { cause: error });
  }
}
