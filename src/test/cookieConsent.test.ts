import { afterEach, describe, expect, it } from "vitest";
import { CONSENT_KEY, readConsent, writeConsent, clearConsent } from "@/lib/cookieConsent";

describe("cookieConsent", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("returns null when no consent recorded", () => {
    expect(readConsent()).toBeNull();
  });

  it("persists analytics opt-in and reads it back", () => {
    const rec = writeConsent(true);
    expect(rec.analytics).toBe(true);
    expect(rec.essential).toBe(true);
    const back = readConsent();
    expect(back?.analytics).toBe(true);
  });

  it("essential-only choice keeps analytics off", () => {
    writeConsent(false);
    expect(readConsent()?.analytics).toBe(false);
  });

  it("ignores malformed payloads", () => {
    localStorage.setItem(CONSENT_KEY, "not-json");
    expect(readConsent()).toBeNull();
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ version: 99 }));
    expect(readConsent()).toBeNull();
  });

  it("clearConsent removes the entry", () => {
    writeConsent(true);
    clearConsent();
    expect(readConsent()).toBeNull();
  });
});
