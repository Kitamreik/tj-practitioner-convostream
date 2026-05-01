import { describe, it, expect, beforeEach } from "vitest";

// IMPORTANT: webmasterCooldown imports `@/lib/firebase` at module-load, which
// initializes Firebase. We only test the pure localStorage helpers, but the
// import side-effect would still try to talk to Firestore. Stub `getFirestore`
// before the import.
import {
  getLocalCooldownMin,
  getLocalSlackAlertConfigured,
  DEFAULT_COOLDOWN_MIN,
  COOLDOWN_OPTIONS_MIN,
} from "@/lib/webmasterCooldown";

describe("webmasterCooldown — local mirrors", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the default cooldown when nothing is stored", () => {
    expect(getLocalCooldownMin()).toBe(DEFAULT_COOLDOWN_MIN);
  });

  it("ignores invalid stored values and falls back to default", () => {
    localStorage.setItem("convohub.webmasterCooldownMin", "999");
    expect(getLocalCooldownMin()).toBe(DEFAULT_COOLDOWN_MIN);

    localStorage.setItem("convohub.webmasterCooldownMin", "not-a-number");
    expect(getLocalCooldownMin()).toBe(DEFAULT_COOLDOWN_MIN);
  });

  it("accepts every value in COOLDOWN_OPTIONS_MIN", () => {
    for (const opt of COOLDOWN_OPTIONS_MIN) {
      localStorage.setItem("convohub.webmasterCooldownMin", String(opt));
      expect(getLocalCooldownMin()).toBe(opt);
    }
  });

  it("treats the slack-configured flag as boolean '1'/'0'", () => {
    expect(getLocalSlackAlertConfigured()).toBe(false);
    localStorage.setItem("convohub.slackAlertConfigured", "1");
    expect(getLocalSlackAlertConfigured()).toBe(true);
    localStorage.setItem("convohub.slackAlertConfigured", "0");
    expect(getLocalSlackAlertConfigured()).toBe(false);
    localStorage.setItem("convohub.slackAlertConfigured", "true");
    // Strict "1" comparison — anything else is false.
    expect(getLocalSlackAlertConfigured()).toBe(false);
  });
});
