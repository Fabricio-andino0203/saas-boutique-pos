import { describe, expect, it } from "vitest";

import { endOfLocalDay, startOfLocalDay } from "@/lib/dates";
import {
  MAX_RANGE_DAYS,
  daysInRange,
  parseRange,
  rangeForPreset,
  type RangePreset,
} from "@/modules/reports/ranges";

// Miércoles 28 de octubre de 2026, 12:00 en Honduras (UTC−6)
const NOW = new Date("2026-10-28T18:00:00Z");

describe("rangeForPreset", () => {
  it.each<[RangePreset, string, string]>([
    ["today", "2026-10-28", "2026-10-28"],
    ["yesterday", "2026-10-27", "2026-10-27"],
    ["week", "2026-10-26", "2026-10-28"], // la semana empieza el lunes
    ["month", "2026-10-01", "2026-10-28"],
    ["last30", "2026-09-29", "2026-10-28"],
    ["year", "2026-01-01", "2026-10-28"],
  ])("%s goes from %s to %s", (preset, from, to) => {
    const range = rangeForPreset(preset, NOW);
    expect(range).toMatchObject({ fromKey: from, toKey: to, preset });
    expect(range.from).toEqual(startOfLocalDay(new Date(`${from}T18:00:00Z`)));
    expect(range.to).toEqual(endOfLocalDay(new Date(`${to}T18:00:00Z`)));
  });

  it("starts the week on Monday also when today is Monday or Sunday", () => {
    expect(rangeForPreset("week", new Date("2026-10-26T18:00:00Z")).fromKey).toBe("2026-10-26");
    expect(rangeForPreset("week", new Date("2026-11-01T18:00:00Z")).fromKey).toBe("2026-10-26");
  });

  it("uses the Honduras date even when UTC is already the next day", () => {
    // 21:00 en Honduras del 28 = 03:00 UTC del 29
    expect(rangeForPreset("today", new Date("2026-10-29T03:00:00Z")).fromKey).toBe("2026-10-28");
  });
});

describe("parseRange", () => {
  it("takes a preset first, then explicit dates, then the fallback", () => {
    expect(parseRange({ rango: "week" }, NOW).fromKey).toBe("2026-10-26");
    expect(
      parseRange({ rango: "week", desde: "2026-01-01", hasta: "2026-01-31" }, NOW).preset,
    ).toBe("week");
    expect(parseRange({ desde: "2026-09-01", hasta: "2026-09-15" }, NOW)).toMatchObject({
      fromKey: "2026-09-01",
      toKey: "2026-09-15",
      preset: null,
    });
    expect(parseRange({}, NOW)).toMatchObject({ preset: "month", fromKey: "2026-10-01" });
    expect(parseRange({}, NOW, "today").preset).toBe("today");
  });

  it("swaps dates that come reversed and ignores what is not a date", () => {
    expect(parseRange({ desde: "2026-09-15", hasta: "2026-09-01" }, NOW)).toMatchObject({
      fromKey: "2026-09-01",
      toKey: "2026-09-15",
    });
    expect(parseRange({ desde: "no", hasta: "2026-09-01" }, NOW).preset).toBe("month");
    expect(parseRange({ rango: "siempre" }, NOW).preset).toBe("month");
    expect(parseRange({ desde: "2026-02-30", hasta: "2026-03-01" }, NOW).preset).toBe("month");
  });

  it("refuses periods longer than two years", () => {
    expect(MAX_RANGE_DAYS).toBe(732);
    expect(parseRange({ desde: "2024-01-01", hasta: "2026-10-01" }, NOW).preset).toBe("month");
    expect(parseRange({ desde: "2025-01-01", hasta: "2026-10-01" }, NOW).fromKey).toBe(
      "2025-01-01",
    );
  });
});

describe("daysInRange", () => {
  it("counts calendar days, both ends included", () => {
    expect(daysInRange(rangeForPreset("today", NOW))).toBe(1);
    expect(daysInRange(rangeForPreset("last30", NOW))).toBe(30);
    expect(daysInRange(rangeForPreset("week", NOW))).toBe(3);
    expect(daysInRange(rangeForPreset("year", NOW))).toBe(301);
  });
});
