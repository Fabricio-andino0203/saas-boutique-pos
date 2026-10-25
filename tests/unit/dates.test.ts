import { describe, expect, it } from "vitest";

import {
  APP_TIME_ZONE,
  addLocalDays,
  endOfLocalDay,
  formatLocalDateTime,
  localDateKey,
  startOfLocalDay,
} from "@/lib/dates";
import { ValidationError } from "@/lib/errors";

const utc = (iso: string): Date => new Date(iso);

describe("APP_TIME_ZONE", () => {
  it("is the Honduras time zone", () => {
    expect(APP_TIME_ZONE).toBe("America/Tegucigalpa");
  });
});

describe("localDateKey", () => {
  it("uses the local calendar day (UTC-6)", () => {
    expect(localDateKey(utc("2026-10-23T05:30:00.000Z"))).toBe("2026-10-22");
    expect(localDateKey(utc("2026-10-23T06:00:00.000Z"))).toBe("2026-10-23");
    expect(localDateKey(utc("2026-10-23T05:59:59.999Z"))).toBe("2026-10-22");
  });
});

describe("startOfLocalDay / endOfLocalDay", () => {
  it("returns the UTC instants of the local day boundaries", () => {
    const date = utc("2026-10-23T05:30:00.000Z");
    expect(startOfLocalDay(date).toISOString()).toBe("2026-10-22T06:00:00.000Z");
    expect(endOfLocalDay(date).toISOString()).toBe("2026-10-23T05:59:59.999Z");
  });
});

describe("addLocalDays", () => {
  it("adds calendar days keeping the local time", () => {
    expect(addLocalDays(utc("2026-10-22T20:15:00.000Z"), 30).toISOString()).toBe(
      "2026-11-21T20:15:00.000Z",
    );
    expect(addLocalDays(utc("2026-10-22T20:15:00.000Z"), -1).toISOString()).toBe(
      "2026-10-21T20:15:00.000Z",
    );
  });

  it("handles a leap day", () => {
    expect(addLocalDays(utc("2028-02-28T18:00:00.000Z"), 1).toISOString()).toBe(
      "2028-02-29T18:00:00.000Z",
    );
  });

  it("rejects a non-integer number of days", () => {
    expect(() => addLocalDays(utc("2026-10-22T20:15:00.000Z"), 1.5)).toThrow(ValidationError);
  });
});

describe("formatLocalDateTime", () => {
  it("assembles DD/MM/YYYY HH:mm in 24 hours", () => {
    expect(formatLocalDateTime(utc("2026-10-23T06:00:00.000Z"))).toBe("23/10/2026 00:00");
    expect(formatLocalDateTime(utc("2026-10-23T18:05:00.000Z"))).toBe("23/10/2026 12:05");
    expect(formatLocalDateTime(utc("2026-01-01T00:00:00.000Z"))).toBe("31/12/2025 18:00");
  });
});

describe("invalid dates", () => {
  const invalid = new Date("no-es-fecha");

  it("makes every helper throw ValidationError", () => {
    expect(() => localDateKey(invalid)).toThrow(ValidationError);
    expect(() => startOfLocalDay(invalid)).toThrow(ValidationError);
    expect(() => endOfLocalDay(invalid)).toThrow(ValidationError);
    expect(() => addLocalDays(invalid, 1)).toThrow(ValidationError);
    expect(() => formatLocalDateTime(invalid)).toThrow(ValidationError);
  });
});
