import { describe, expect, it } from "vitest";

import { platformMessages } from "@/config/messages.platform.es";
import { PLATFORM_AUDIT_ACTIONS, sanitizeDetails } from "@/modules/platform/audit";

describe("sanitizeDetails", () => {
  it("drops anything that looks like a secret, whatever the casing", () => {
    expect(
      sanitizeDetails({
        username: "ana",
        password: "x",
        newPassword: "x",
        actorPassword: "x",
        totpSecret: "x",
        otpCode: "123456",
        sessionToken: "x",
        dbCredential: "x",
        privateKey: "x",
        attempts: 3,
      }),
    ).toEqual({ username: "ana", attempts: 3 });
  });

  it("keeps key versions and counters, and removes undefined values", () => {
    expect(sanitizeDetails({ toVersion: 2, rotated: 0, missing: undefined })).toEqual({
      toVersion: 2,
      rotated: 0,
    });
  });

  it("returns undefined when there is nothing to record", () => {
    expect(sanitizeDetails(undefined)).toBeUndefined();
  });
});

describe("platform audit catalog", () => {
  it("has a Spanish label for every action", () => {
    for (const action of PLATFORM_AUDIT_ACTIONS) {
      const label = (platformMessages.audit.actions as Record<string, string>)[action];
      expect(label, action).toBeTruthy();
    }
    expect(Object.keys(platformMessages.audit.actions).sort()).toEqual(
      [...PLATFORM_AUDIT_ACTIONS].sort(),
    );
  });
});
