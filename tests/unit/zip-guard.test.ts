import { deflateRawSync } from "node:zlib";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { messages } from "@/config/messages.es";
import { IMPORT_MAX_ROWS } from "@/modules/products/import/plan";
import { planImport } from "@/modules/products/import/service";
import { readTable, SpreadsheetTooBigError } from "@/modules/products/import/table";
import { buildTemplateXlsx } from "@/modules/products/import/template";
import {
  IMPORT_MAX_COLUMNS,
  IMPORT_MAX_UNZIPPED_BYTES,
  IMPORT_MAX_ZIP_ENTRIES,
  inspectZip,
  isSafeWorkbook,
  workbookVerdict,
} from "@/modules/products/import/zip-guard";

/**
 * Un .xlsx es un zip. Estas pruebas arman zips a mano (sin comprimir de verdad) para comprobar que el índice se lee bien y que un
 * archivo que DECLARA ser enorme se rechaza antes de descomprimirlo.
 */

type Entry = { name: string; declaredSize: number; stored: Buffer };

function buildZip(entries: Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(entry.stored.length, 18);
    local.writeUInt32LE(entry.declaredSize, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, entry.stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(entry.stored.length, 20);
    central.writeUInt32LE(entry.declaredSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + entry.stored.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const small = (name: string, size = 100): Entry => ({
  name,
  declaredSize: size,
  stored: Buffer.alloc(4),
});

describe("inspectZip", () => {
  it("adds up what the archive declares without opening anything", () => {
    const zip = buildZip([small("a.xml", 1_000), small("b.xml", 2_500), small("c.xml", 500)]);
    expect(inspectZip(zip)).toEqual({ entries: 3, unzippedBytes: 4_000 });
  });

  it("reads an archive that has a trailing comment", () => {
    const comment = Buffer.from("un comentario al final del archivo");
    const zip = buildZip([small("a.xml", 10)]);
    zip.writeUInt16LE(comment.length, zip.length - 2);
    expect(inspectZip(Buffer.concat([zip, comment]))).toEqual({ entries: 1, unzippedBytes: 10 });
  });

  it.each([
    ["an empty file", Buffer.alloc(0)],
    ["plain text", Buffer.from("esto no es un zip")],
    ["a truncated archive", buildZip([small("a.xml")]).subarray(0, 40)],
  ])("returns null for %s", (_name, bytes) => {
    expect(inspectZip(bytes)).toBeNull();
  });

  it("returns null when the index points outside the file", () => {
    const zip = buildZip([small("a.xml")]);
    zip.writeUInt32LE(zip.length + 1000, zip.length - 22 + 16);
    expect(inspectZip(zip)).toBeNull();
  });

  it("reports ZIP64 sizes apart (a spreadsheet of products never needs them)", () => {
    expect(inspectZip(buildZip([small("a.xml", 0xffffffff)]))).toBe("zip64");
  });
});

describe("isSafeWorkbook", () => {
  it("accepts a real spreadsheet", async () => {
    expect(isSafeWorkbook(await buildTemplateXlsx())).toBe(true);
  });

  it("rejects an archive that declares more than the limit once unzipped", () => {
    const bomb = buildZip([small("hoja.xml", IMPORT_MAX_UNZIPPED_BYTES + 1)]);
    expect(isSafeWorkbook(bomb)).toBe(false);
    expect(isSafeWorkbook(buildZip([small("hoja.xml", IMPORT_MAX_UNZIPPED_BYTES)]))).toBe(true);
  });

  it("rejects an archive of thousands of tiny entries", () => {
    const many = Array.from({ length: IMPORT_MAX_ZIP_ENTRIES + 1 }, (_, index) =>
      small(`f${index}.xml`, 10),
    );
    expect(isSafeWorkbook(buildZip(many))).toBe(false);
  });

  it("rejects what is not a zip at all, but tells it apart from a file that is too big", () => {
    expect(isSafeWorkbook(Buffer.from("no soy un zip"))).toBe(false);
    expect(workbookVerdict(Buffer.from("no soy un zip"))).toBe("not-a-zip");
    expect(workbookVerdict(new Uint8Array([1, 2, 3, 4]))).toBe("not-a-zip");
    expect(workbookVerdict(buildZip([small("hoja.xml", IMPORT_MAX_UNZIPPED_BYTES + 1)]))).toBe(
      "too-big",
    );
    expect(workbookVerdict(buildZip([small("hoja.xml", 0xffffffff)]))).toBe("too-big");
  });

  it("a real compression bomb is small on disk and huge once unzipped, and is caught from its index alone", () => {
    const zeros = Buffer.alloc(IMPORT_MAX_UNZIPPED_BYTES + 10 * 1024 * 1024);
    const stored = deflateRawSync(zeros);
    expect(stored.length).toBeLessThan(5 * 1024 * 1024);
    const bomb = buildZip([
      { name: "xl/worksheets/sheet1.xml", declaredSize: zeros.length, stored },
    ]);
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    expect(isSafeWorkbook(bomb)).toBe(false);
  });
});

describe("a spreadsheet that claims too many rows or columns", () => {
  async function workbookWith(rows: number, columns: number): Promise<Uint8Array> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Productos");
    sheet.getRow(rows).getCell(columns).value = "x";
    return new Uint8Array(await workbook.xlsx.writeBuffer());
  }

  it("is rejected before it is walked", async () => {
    const tallFile = {
      name: "alto.xlsx",
      bytes: await workbookWith(IMPORT_MAX_ROWS + 500, 5),
      size: 0,
    };
    await expect(readTable(tallFile)).rejects.toBeInstanceOf(SpreadsheetTooBigError);
    const wideFile = {
      name: "ancho.xlsx",
      bytes: await workbookWith(5, IMPORT_MAX_COLUMNS + 1),
      size: 0,
    };
    await expect(readTable(wideFile)).rejects.toBeInstanceOf(SpreadsheetTooBigError);
  });

  it("a normal sheet is read as before", async () => {
    const file = { name: "normal.xlsx", bytes: await workbookWith(10, 5), size: 0 };
    const rows = await readTable(file);
    expect(rows).toHaveLength(10);
    expect(rows[9]?.[4]).toBe("x");
  });

  it("the import reports it to the person with a clear message, never a crash", async () => {
    const zeros = Buffer.alloc(IMPORT_MAX_UNZIPPED_BYTES + 1024);
    const bomb = buildZip([
      {
        name: "xl/worksheets/sheet1.xml",
        declaredSize: zeros.length,
        stored: deflateRawSync(zeros),
      },
    ]);
    const plan = await planImport(
      { id: "u1", role: "OWNER" },
      { name: "bomba.xlsx", size: bomb.length, bytes: bomb },
    );
    expect(plan.problems[0]?.message).toBe(messages.products.import.problems.fileTooComplex);
  });
});
