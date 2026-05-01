import { describe, it, expect } from "vitest";
import {
  computeSmsLimits,
  applyTemplateVars,
  buildContextLine,
  buildSmsHref,
  buildTelHref,
  formatRelative,
} from "@/lib/smsLimits";

describe("smsLimits — computeSmsLimits", () => {
  it("treats an empty body as a single GSM-7 segment with full headroom", () => {
    const r = computeSmsLimits("", "+17206639706");
    expect(r.encoding).toBe("GSM-7");
    expect(r.segments).toBe(1);
    expect(r.perSegment).toBe(160);
    expect(r.charCount).toBe(0);
    expect(r.remainingInSegment).toBe(160);
    expect(r.level).toBe("ok");
    expect(r.recipientValid).toBe(true);
  });

  it("keeps a 160-char ASCII body at one GSM-7 segment", () => {
    const body = "a".repeat(160);
    const r = computeSmsLimits(body, "+17206639706");
    expect(r.segments).toBe(1);
    expect(r.encoding).toBe("GSM-7");
    expect(r.level).toBe("ok");
  });

  it("splits at 161 chars into two concatenated GSM-7 segments (153/each)", () => {
    const body = "a".repeat(161);
    const r = computeSmsLimits(body, "+17206639706");
    expect(r.segments).toBe(2);
    expect(r.perSegment).toBe(153);
    expect(r.level).toBe("ok");
  });

  it("upgrades to UCS-2 when an emoji is present", () => {
    const r = computeSmsLimits("hello 😀", "+17206639706");
    expect(r.encoding).toBe("UCS-2");
  });

  it("warns above 3 segments and blocks above 10 segments", () => {
    const warn = computeSmsLimits("a".repeat(700), "+17206639706"); // ~5 segs
    expect(warn.level).toBe("warn");
    expect(warn.segments).toBeGreaterThan(3);

    const block = computeSmsLimits("a".repeat(1700), "+17206639706"); // >10 segs
    expect(block.level).toBe("block");
    expect(block.segments).toBeGreaterThan(10);
  });

  it("blocks when the URL-encoded sms: link exceeds 2048 chars", () => {
    // Heavy emoji body inflates URI length much faster than visible chars.
    const r = computeSmsLimits("😀".repeat(400), "+17206639706");
    expect(r.uriLength).toBeGreaterThan(2048);
    expect(r.level).toBe("block");
  });

  it("rejects an obviously bad recipient as a hard block", () => {
    const r = computeSmsLimits("hi", "abc");
    expect(r.recipientValid).toBe(false);
    expect(r.level).toBe("block");
    expect(r.reason).toContain("not a valid E.164");
  });

  it("accepts a clean E.164 number", () => {
    expect(computeSmsLimits("hi", "+17206639706").recipientValid).toBe(true);
    expect(computeSmsLimits("hi", "+442071838750").recipientValid).toBe(true);
  });
});

describe("smsLimits — applyTemplateVars", () => {
  it("substitutes name/agent/company tokens", () => {
    const out = applyTemplateVars("Hi {{name}}, {{agent}} at {{company}}", "Alex");
    expect(out).toBe("Hi Webmaster, Alex at ConvoHub");
  });

  it("leaves unrelated braces alone", () => {
    expect(applyTemplateVars("code: { not a var }", "Alex")).toBe("code: { not a var }");
  });
});

describe("smsLimits — context + href builders", () => {
  it("falls back to a generic name when the agent name is blank", () => {
    expect(buildContextLine("   ", "/conversations")).toBe(
      "Hi, this is a teammate from /conversations — "
    );
  });

  it("truncates a long route to 80 chars", () => {
    const longRoute = "/x".repeat(200);
    const line = buildContextLine("Alex", longRoute);
    // The route portion is sliced to 80; the surrounding text adds the rest.
    expect(line.length).toBeLessThanOrEqual("Hi, this is Alex from ".length + 80 + " — ".length);
  });

  it("URL-encodes the SMS body and uses the supplied recipient", () => {
    const href = buildSmsHref("Alex", "/conversations", "+17206639706");
    expect(href.startsWith("sms:+17206639706?body=")).toBe(true);
    expect(href).toContain(encodeURIComponent("Alex"));
  });

  it("emits an RFC 3966 tel: URI with a phone-context segment", () => {
    const href = buildTelHref("Alex", "/", "+17206639706");
    expect(href.startsWith("tel:+17206639706;phone-context=")).toBe(true);
    expect(href).toContain(encodeURIComponent("Hi, this is Alex from / —"));
  });
});

describe("smsLimits — formatRelative", () => {
  const NOW = 1_700_000_000_000;
  it("returns 'just now' under a minute", () => {
    expect(formatRelative(NOW - 30_000, NOW)).toBe("just now");
  });
  it("returns minutes between 1 and 59", () => {
    expect(formatRelative(NOW - 5 * 60_000, NOW)).toBe("5 min ago");
  });
  it("returns hours between 1 and 23", () => {
    expect(formatRelative(NOW - 3 * 3600_000, NOW)).toBe("3h ago");
  });
  it("returns days at and beyond 24h", () => {
    expect(formatRelative(NOW - 2 * 86_400_000, NOW)).toBe("2d ago");
  });
});
