import { describe, expect, it } from "vitest";

import { messages } from "@/config/messages.es";
import { APP_ERROR_CODES } from "@/lib/errors";

describe("messages.errors", () => {
  it("has exactly one entry per error code plus UNEXPECTED", () => {
    expect(Object.keys(messages.errors).sort()).toEqual([...APP_ERROR_CODES, "UNEXPECTED"].sort());
  });

  it("has a non-empty text for every code", () => {
    for (const text of Object.values(messages.errors)) {
      expect(typeof text).toBe("string");
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });
});
