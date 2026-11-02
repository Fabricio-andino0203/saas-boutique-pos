import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createS3Store } from "@/lib/s3-blob-store";

/**
 * Un servicio S3 de mentira, en memoria: guarda, devuelve y borra objetos por «/<bucket>/<clave>» (estilo de ruta). Basta para
 * comprobar que el almacén habla bien con el SDK (firma, rutas, respuestas de error), no que un servicio real lo acepte.
 */
const objects = new Map<string, { body: Buffer; type: string }>();
const requests: { method: string; path: string }[] = [];
let server: Server;
let endpoint: string;

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

beforeAll(async () => {
  server = createServer((request, response) => {
    void (async () => {
      const path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");
      requests.push({ method: request.method ?? "", path });
      if (!request.headers.authorization?.startsWith("AWS4-HMAC-SHA256")) {
        response.writeHead(403).end("<Error><Code>AccessDenied</Code></Error>");
        return;
      }
      if (request.method === "PUT") {
        objects.set(path, {
          body: await readBody(request),
          type: String(request.headers["content-type"] ?? ""),
        });
        response.writeHead(200, { ETag: '"fake"' }).end();
      } else if (request.method === "GET") {
        const found = objects.get(path);
        if (!found) {
          response
            .writeHead(404, { "Content-Type": "application/xml" })
            .end("<Error><Code>NoSuchKey</Code><Message>nope</Message></Error>");
          return;
        }
        response
          .writeHead(200, { "Content-Type": found.type, "Content-Length": found.body.length })
          .end(found.body);
      } else if (request.method === "DELETE") {
        objects.delete(path);
        response.writeHead(204).end();
      } else {
        response.writeHead(405).end();
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  objects.clear();
  requests.length = 0;
});

const store = () =>
  createS3Store({
    endpoint,
    region: "auto",
    bucket: "fotos-test",
    accessKeyId: "AKIAPRUEBA",
    secretAccessKey: "secreto-de-prueba",
    forcePathStyle: true,
  });

describe("createS3Store", () => {
  it("stores a file under its key and returns the same bytes", async () => {
    await store().put("t1/p1/i1/thumb.webp", Buffer.from([1, 2, 3, 4]));

    expect(objects.get("/fotos-test/t1/p1/i1/thumb.webp")?.type).toBe("image/webp");
    const read = await store().get("t1/p1/i1/thumb.webp");
    expect(read && [...read]).toEqual([1, 2, 3, 4]);
  });

  it("returns null for a file that is not there", async () => {
    expect(await store().get("t1/p1/i1/nada.webp")).toBeNull();
  });

  it("removes files and does not complain about the ones already gone", async () => {
    await store().put("t1/p1/i1/thumb.webp", Buffer.from("a"));
    await store().put("t1/p1/i1/medium.webp", Buffer.from("b"));

    await store().remove(["t1/p1/i1/thumb.webp", "t1/p1/i1/medium.webp", "t1/p1/i1/large.webp"]);

    expect(objects.size).toBe(0);
    await store().remove([]); // nada que hacer
  });

  it("refuses an unsafe key before touching the network", async () => {
    await expect(store().put("../escape.webp", Buffer.from("x"))).rejects.toThrow(
      "Invalid blob key",
    );
    await expect(store().get("/abs.webp")).rejects.toThrow("Invalid blob key");
    await expect(store().remove(["a/../b.webp"])).rejects.toThrow("Invalid blob key");
    expect(requests).toEqual([]);
  });

  it("surfaces a real failure instead of hiding it as 'not found'", async () => {
    const rejected = createS3Store({
      endpoint,
      region: "auto",
      bucket: "fotos-test",
      accessKeyId: "AKIAPRUEBA",
      secretAccessKey: "x",
      forcePathStyle: true,
    });
    // El servicio de mentira solo exige una firma; aquí se apaga el servidor de ese origen cambiando el puerto.
    const unreachable = createS3Store({
      endpoint: "http://127.0.0.1:1",
      region: "auto",
      bucket: "fotos-test",
      accessKeyId: "a",
      secretAccessKey: "b",
      forcePathStyle: true,
    });
    await expect(unreachable.get("t1/p1/i1/thumb.webp")).rejects.toThrow();
    expect(await rejected.get("t1/p1/i1/otra.webp")).toBeNull();
  });
});
