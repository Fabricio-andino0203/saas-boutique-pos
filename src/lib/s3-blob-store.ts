import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { parseBlobKey, type BlobStore } from "@/lib/blob-store";

/**
 * El almacén de archivos en un servicio de objetos compatible con S3 (el Bucket de Railway, R2, S3…). Mismas claves y mismas
 * garantías que el de carpeta: una clave insegura se rechaza antes de tocar la red, leer lo que no existe da `null` y borrar lo
 * que ya no está no es un error.
 */
export type S3StoreOptions = {
  /** Dirección del servicio (`https://t3.storageapi.dev`). Vacía = la de AWS S3. */
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** `bucket` en la ruta en vez de en el nombre del servidor: lo piden servicios viejos y las pruebas. */
  forcePathStyle?: boolean;
};

function contentTypeOf(key: string): string {
  return key.endsWith(".webp") ? "image/webp" : "application/octet-stream";
}

function isNotFound(error: unknown): boolean {
  const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } } | undefined;
  return failure?.name === "NoSuchKey" || failure?.$metadata?.httpStatusCode === 404;
}

export function createS3Store(options: S3StoreOptions): BlobStore {
  const client = new S3Client({
    region: options.region,
    endpoint: options.endpoint,
    forcePathStyle: options.forcePathStyle,
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    // Los servicios compatibles con S3 no entienden todavía las sumas de verificación que el SDK agrega por omisión.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const Bucket = options.bucket;

  return {
    async put(key, data) {
      parseBlobKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: data,
          ContentType: contentTypeOf(key),
        }),
      );
    },

    async get(key) {
      parseBlobKey(key);
      try {
        const response = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        return Buffer.from((await response.Body?.transformToByteArray()) ?? []);
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },

    async remove(keys) {
      keys.forEach(parseBlobKey);
      // Uno por uno (DeleteObject es idempotente y lo entienden todos los servicios); son tres por foto.
      await Promise.all(keys.map((Key) => client.send(new DeleteObjectCommand({ Bucket, Key }))));
    },
  };
}
