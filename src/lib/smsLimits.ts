/**
 * Pure helpers for the webmaster contact buttons. Extracted from
 * `WebmasterContactButtons.tsx` so they can be unit-tested without spinning
 * up React / Firebase. Behavior is unchanged — see the original component
 * for full design notes.
 */

const GSM7_REGEX = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;
const SOFT_SEGMENT_WARN = 3;
const HARD_SEGMENT_LIMIT = 10;
const SMS_URI_SOFT_LIMIT = 1500;
const SMS_URI_HARD_LIMIT = 2048;
const E164_MAX_LENGTH = 16;
const E164_MIN_LENGTH = 8;

export const DEFAULT_WEBMASTER_NUMBER =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_WEBMASTER_PHONE_E164) ||
  "+17206639706";

export interface SmsLimits {
  encoding: "GSM-7" | "UCS-2";
  perSegment: number;
  segments: number;
  charCount: number;
  remainingInSegment: number;
  uriLength: number;
  recipientLength: number;
  recipientValid: boolean;
  level: "ok" | "warn" | "block";
  reason?: string;
  recommendation?: string;
}

export function computeSmsLimits(body: string, recipient: string = DEFAULT_WEBMASTER_NUMBER): SmsLimits {
  const charCount = body.length;
  const isGsm = GSM7_REGEX.test(body);
  const encoding: SmsLimits["encoding"] = isGsm ? "GSM-7" : "UCS-2";

  const singleCap = isGsm ? 160 : 70;
  const concatCap = isGsm ? 153 : 67;

  let segments: number;
  let perSegment: number;
  if (charCount === 0) {
    segments = 1;
    perSegment = singleCap;
  } else if (charCount <= singleCap) {
    segments = 1;
    perSegment = singleCap;
  } else {
    segments = Math.ceil(charCount / concatCap);
    perSegment = concatCap;
  }

  const remainingInSegment = Math.max(0, segments * perSegment - charCount);

  const uriBody = encodeURIComponent(body);
  const uriLength = `sms:${recipient}?body=${uriBody}`.length;

  const trimmedRecipient = recipient.trim();
  const recipientLength = trimmedRecipient.length;
  const recipientDigits = trimmedRecipient.replace(/[^\d]/g, "");
  const recipientValid =
    /^\+?\d+$/.test(trimmedRecipient) &&
    recipientLength >= E164_MIN_LENGTH &&
    recipientLength <= E164_MAX_LENGTH &&
    recipientDigits.length >= 7 &&
    recipientDigits.length <= 15;

  let level: SmsLimits["level"] = "ok";
  let reason: string | undefined;
  let recommendation: string | undefined;

  if (!recipientValid) {
    level = "block";
    reason = `Recipient number "${trimmedRecipient}" is not a valid E.164 phone number (${recipientLength} chars).`;
    recommendation = `Use the international format with a leading "+" and ${E164_MIN_LENGTH - 1}–15 digits (e.g. +17206639706).`;
  } else if (uriLength > SMS_URI_HARD_LIMIT) {
    level = "block";
    reason = `URL-encoded SMS link is ${uriLength} chars — exceeds the ${SMS_URI_HARD_LIMIT}-char OS limit, so the composer will silently truncate the body.`;
    recommendation = `Trim the body by ~${Math.ceil((uriLength - SMS_URI_HARD_LIMIT) / 3)} chars (URL encoding inflates emoji/punctuation ~3×).`;
  } else if (segments > HARD_SEGMENT_LIMIT) {
    level = "block";
    reason = `Exceeds the ${HARD_SEGMENT_LIMIT}-segment carrier hard cap (${segments} segments). Most US carriers will reject this message.`;
    recommendation = `Trim to ≤ ${HARD_SEGMENT_LIMIT * perSegment} chars or split into multiple sends.`;
  } else if (uriLength > SMS_URI_SOFT_LIMIT) {
    level = "warn";
    reason = `URL-encoded link is ${uriLength} chars — within ${SMS_URI_HARD_LIMIT - uriLength} of the OS truncation limit.`;
    recommendation = `Some carriers/OS combos truncate around 1.6 KB. Consider trimming or sending a follow-up.`;
  } else if (segments > SOFT_SEGMENT_WARN) {
    level = "warn";
    reason = `${segments} segments will be billed and may arrive out of order or be split by the recipient's carrier.`;
    recommendation = `Aim for ≤ ${SOFT_SEGMENT_WARN * perSegment} chars to fit in ${SOFT_SEGMENT_WARN} segments.`;
  } else if (!isGsm && segments > 1) {
    level = "warn";
    reason = `Non-GSM characters force UCS-2 encoding (${concatCap} chars/segment) — consider removing emoji or smart quotes.`;
    recommendation = `Replace smart quotes (" ") with ASCII (" ') and drop emoji to switch back to GSM-7 (160 chars/segment).`;
  }

  return {
    encoding,
    perSegment,
    segments,
    charCount,
    remainingInSegment,
    uriLength,
    recipientLength,
    recipientValid,
    level,
    reason,
    recommendation,
  };
}

export function applyTemplateVars(body: string, agentName: string): string {
  return body
    .replace(/\{\{name\}\}/g, "Webmaster")
    .replace(/\{\{agent\}\}/g, agentName)
    .replace(/\{\{company\}\}/g, "ConvoHub");
}

export function buildContextLine(name: string, route: string): string {
  const safeName = name.trim() || "a teammate";
  const safeRoute = (route || "/").slice(0, 80);
  return `Hi, this is ${safeName} from ${safeRoute} — `;
}

export function buildSmsHref(
  name: string,
  route: string,
  recipient: string = DEFAULT_WEBMASTER_NUMBER
): string {
  const body = buildContextLine(name, route);
  return `sms:${recipient}?body=${encodeURIComponent(body)}`;
}

export function buildTelHref(
  name: string,
  route: string,
  recipient: string = DEFAULT_WEBMASTER_NUMBER
): string {
  const ctx = buildContextLine(name, route).trim();
  return `tel:${recipient};phone-context=${encodeURIComponent(ctx)}`;
}

export function formatRelative(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
