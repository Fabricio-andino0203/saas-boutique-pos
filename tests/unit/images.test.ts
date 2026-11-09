import { crc32, deflateSync } from "node:zlib";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ImageTooLargeError, InvalidImageError } from "@/lib/errors";
import {
  LOGO_MAX_BYTES,
  PHOTO_MAX_BYTES,
  PHOTO_SIZES,
  isPhotoSize,
  processLogo,
  processPhoto,
  sniffImageFormat,
} from "@/lib/images";

function solid(width: number, height: number, channels: 3 | 4 = 3, background = "#cc3344") {
  return sharp({ create: { width, height, channels, background } });
}

const jpeg = (width: number, height: number) => solid(width, height).jpeg().toBuffer();

/** Un PNG que dice medir `width × height` sin traer los píxeles: sirve para probar el límite sin gastar memoria. */
function pixelBomb(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB, sin interlazado
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc(0))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("sniffImageFormat", () => {
  it("recognises JPEG, PNG and WebP by their content", async () => {
    expect(sniffImageFormat(await jpeg(8, 8))).toBe("jpeg");
    expect(sniffImageFormat(await solid(8, 8).png().toBuffer())).toBe("png");
    expect(sniffImageFormat(await solid(8, 8).webp().toBuffer())).toBe("webp");
  });

  it.each([
    ["text", Buffer.from("hola, esto no es una foto")],
    ["an SVG, which can carry code", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ["a GIF", Buffer.from("GIF89a....")],
    ["a PDF", Buffer.from("%PDF-1.7")],
    ["nothing", Buffer.alloc(0)],
    ["a RIFF that is not WebP (a WAV)", Buffer.from("RIFF\0\0\0\0WAVEfmt ")],
  ])("does not recognise %s", (_name, bytes) => {
    expect(sniffImageFormat(bytes)).toBeNull();
  });
});

describe("isPhotoSize", () => {
  it("only accepts the sizes that exist", () => {
    expect(Object.keys(PHOTO_SIZES).every(isPhotoSize)).toBe(true);
    expect(isPhotoSize("huge")).toBe(false);
    expect(isPhotoSize("../thumb")).toBe(false);
  });
});

describe("processPhoto", () => {
  it("makes the three WebP sizes, each fitting inside its edge", async () => {
    const photo = await processPhoto(await jpeg(3000, 2000));

    expect(photo.variants.thumb.width).toBe(200);
    expect(Math.abs(photo.variants.thumb.height - 133)).toBeLessThanOrEqual(1);
    expect(photo.variants.medium.width).toBe(720);
    expect(photo.variants.medium.height).toBe(480);
    expect(photo.variants.large.width).toBe(1600);
    expect(Math.abs(photo.variants.large.height - 1067)).toBeLessThanOrEqual(1);
    expect(photo.width).toBe(photo.variants.large.width);
    expect(photo.height).toBe(photo.variants.large.height);

    for (const variant of Object.values(photo.variants)) {
      expect(sniffImageFormat(variant.data)).toBe("webp");
      expect((await sharp(variant.data).metadata()).format).toBe("webp");
      expect(variant.bytes).toBe(variant.data.length);
    }
  });

  it("never enlarges a small photo", async () => {
    const photo = await processPhoto(await jpeg(300, 400));

    expect([photo.variants.thumb.width, photo.variants.thumb.height]).toEqual([150, 200]);
    expect([photo.variants.medium.width, photo.variants.medium.height]).toEqual([300, 400]);
    expect([photo.variants.large.width, photo.variants.large.height]).toEqual([300, 400]);
  });

  it("accepts PNG and WebP too", async () => {
    expect((await processPhoto(await solid(50, 50).png().toBuffer())).width).toBe(50);
    expect((await processPhoto(await solid(60, 40).webp().toBuffer())).width).toBe(60);
  });

  it("turns the photo upright the way it is seen, not the way the phone stored it", async () => {
    // 400 × 200 guardada con la orientación 6 (girar 90°): en pantalla es de 200 × 400.
    const sideways = await solid(400, 200).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(sideways).metadata()).orientation).toBe(6);

    const photo = await processPhoto(sideways);

    expect([photo.width, photo.height]).toEqual([200, 400]);
  });

  it("drops the hidden camera data (GPS, model, copyright)", async () => {
    const withExif = await solid(100, 100)
      .jpeg()
      .withExif({ IFD0: { Copyright: "Dato privado" } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const photo = await processPhoto(withExif);

    for (const variant of Object.values(photo.variants)) {
      const meta = await sharp(variant.data).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
    }
  });

  it("puts a white background where a PNG is transparent", async () => {
    const transparent = await solid(20, 20, 4, { r: 0, g: 0, b: 0, alpha: 0 } as never)
      .png()
      .toBuffer();

    const photo = await processPhoto(transparent);
    const { data } = await sharp(photo.variants.thumb.data)
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect([...data.subarray(0, 3)].every((channel) => channel >= 250)).toBe(true);
  });

  it.each([
    ["an empty file", () => Buffer.alloc(0)],
    ["text renamed to .jpg", () => Buffer.from("esto es texto, no una foto")],
    ["an SVG", () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')],
    ["a GIF", () => Buffer.from("GIF89a\x01\x00\x01\x00")],
    [
      "a JPEG header with garbage behind it",
      () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]),
    ],
  ])("rejects %s", async (_name, make) => {
    await expect(processPhoto(make())).rejects.toBeInstanceOf(InvalidImageError);
  });

  it("rejects a photo that was cut off halfway", async () => {
    const noisy = await sharp({
      create: {
        width: 600,
        height: 600,
        channels: 3,
        background: "#808080",
        noise: { type: "gaussian", mean: 128, sigma: 40 },
      },
    })
      .jpeg()
      .toBuffer();

    await expect(
      processPhoto(noisy.subarray(0, Math.floor(noisy.length / 2))),
    ).rejects.toBeInstanceOf(InvalidImageError);
  });

  it("rejects an image that claims too many pixels without decoding it", async () => {
    await expect(processPhoto(pixelBomb(30_000, 30_000))).rejects.toBeInstanceOf(InvalidImageError);
  });

  it("rejects a file over the size limit, whatever it is", async () => {
    const big = Buffer.alloc(PHOTO_MAX_BYTES + 1, 0);
    big.set([0xff, 0xd8, 0xff]);
    await expect(processPhoto(big)).rejects.toBeInstanceOf(ImageTooLargeError);
    await expect(processPhoto(Buffer.alloc(PHOTO_MAX_BYTES + 1, 65))).rejects.toBeInstanceOf(
      ImageTooLargeError,
    );
  });

  it("does not write anything about the failure into the message people see", async () => {
    const error = await processPhoto(Buffer.from("no soy una foto")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidImageError);
    expect((error as InvalidImageError).code).toBe("INVALID_IMAGE");
  });
});

describe("processLogo", () => {
  const decode = async (dataUri: string) => {
    const [, base64] = dataUri.split(",");
    return Buffer.from(base64 ?? "", "base64");
  };

  it("fits a big colour logo into the 80 mm ticket, in greys, as a PNG data URI", async () => {
    const logo = await processLogo(await solid(1200, 600).png().toBuffer());

    expect(logo.dataUri.startsWith("data:image/png;base64,")).toBe(true);
    // 1200 × 600 cabe en 576 × 240 al reducirlo a la altura: 480 × 240, sin deformar
    expect([logo.width, logo.height]).toEqual([480, 240]);
    const meta = await sharp(await decode(logo.dataUri)).metadata();
    expect(meta).toMatchObject({ format: "png", width: 480, height: 240, channels: 1 });
    expect(logo.bytes).toBeGreaterThan(0);
  });

  it("does not enlarge a small logo", async () => {
    const logo = await processLogo(await solid(100, 50).png().toBuffer());
    expect([logo.width, logo.height]).toEqual([100, 50]);
  });

  it("puts a white background where the logo is transparent, so it prints white and not black", async () => {
    const transparent = await solid(20, 20, 4, { r: 0, g: 0, b: 0, alpha: 0 } as never)
      .png()
      .toBuffer();
    const logo = await processLogo(transparent);
    const { data } = await sharp(await decode(logo.dataUri))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThanOrEqual(250);
  });

  it.each([
    ["text", () => Buffer.from("esto es texto, no un logo")],
    [
      "an SVG, which can carry code",
      () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    ],
    ["a GIF", () => Buffer.from("GIF89a\x01\x00\x01\x00")],
    ["an empty file", () => Buffer.alloc(0)],
  ])("rejects %s", async (_name, make) => {
    await expect(processLogo(make())).rejects.toBeInstanceOf(InvalidImageError);
  });

  it("rejects a file over the logo size limit, whatever it is", async () => {
    await expect(processLogo(Buffer.alloc(LOGO_MAX_BYTES + 1, 65))).rejects.toBeInstanceOf(
      ImageTooLargeError,
    );
  });
});
