/**
 * Lightweight, deterministic PII masking used before any uploaded-document
 * text is surfaced inside a conversation thread. Operates strictly on the
 * source string with regex/dictionary heuristics — no LLM, no inference, no
 * hallucinated content. Scope: PII + names + locations.
 *
 * Limitations are intentional: this is a safety net for accidental exposure,
 * not a forensic redaction tool. Always pair with explicit agent review.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(\+?\d{1,2}[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const DOB = /\b(0?[1-9]|1[0-2])[/\\-.](0?[1-9]|[12]\d|3[01])[/\\-.](19|20)\d{2}\b/g;
const STREET =
  /\b\d{1,5}\s+([A-Z][a-z]+\s){1,3}(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Ter|Parkway|Pkwy|Highway|Hwy)\b\.?/g;
const ZIP = /\b\d{5}(-\d{4})?\b/g;
const CREDIT_CARD = /\b(?:\d[ -]*?){13,16}\b/g;
// Capitalised two-word sequences — naive name detector. Skips obviously
// non-name pairs (very common stop-words at the start of a sentence).
const NAME =
  /\b(?!The|This|That|These|Those|From|With|When|While|After|Before|Today|Tomorrow|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g;

// Curated location list — keeps the regex tractable while catching the
// vocabulary that tends to leak into case notes (US states, large cities,
// Canadian provinces, common country names).
const LOCATIONS = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware",
  "Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky",
  "Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi",
  "Missouri","Montana","Nebraska","Nevada","Ohio","Oklahoma","Oregon","Pennsylvania",
  "Tennessee","Texas","Utah","Vermont","Virginia","Washington","Wisconsin","Wyoming",
  "Ontario","Quebec","Alberta","Manitoba","Saskatchewan",
  "Toronto","Vancouver","Montreal","Calgary","Ottawa",
  "New York","Los Angeles","Chicago","Houston","Phoenix","Philadelphia","San Antonio",
  "San Diego","Dallas","San Jose","Austin","Jacksonville","Seattle","Denver","Boston",
  "Detroit","Atlanta","Miami","Portland","Pittsburgh","Cleveland","Charlotte",
  "USA","United States","Canada","Mexico","UK","United Kingdom","England","Scotland",
  "Wales","Ireland","Australia","India","China","Japan","Germany","France","Spain",
];
const LOCATION_RE = new RegExp(
  "\\b(" + LOCATIONS.map((l) => l.replace(/ /g, "\\s+")).join("|") + ")\\b",
  "g",
);

export interface MaskResult {
  text: string;
  counts: Record<string, number>;
}

export function maskSensitive(input: string): MaskResult {
  const counts: Record<string, number> = {
    email: 0, phone: 0, ssn: 0, dob: 0, street: 0, zip: 0, card: 0, name: 0, location: 0,
  };
  let out = input;
  const tally = (key: string) => (m: string) => { counts[key] += 1; return `[${key.toUpperCase()}_REDACTED]`; };
  out = out.replace(EMAIL, tally("email"));
  out = out.replace(CREDIT_CARD, tally("card"));
  out = out.replace(SSN, tally("ssn"));
  out = out.replace(DOB, tally("dob"));
  out = out.replace(STREET, tally("street"));
  out = out.replace(ZIP, tally("zip"));
  out = out.replace(PHONE, tally("phone"));
  out = out.replace(LOCATION_RE, tally("location"));
  out = out.replace(NAME, tally("name"));
  return { text: out, counts };
}

/**
 * Build a short, deterministic context paragraph from extracted text.
 * Does NOT invent new content — it just clips the start of the masked body
 * and reports detected counts so the agent can decide whether to act.
 */
export function buildExtractedContext(masked: MaskResult, sourceName: string): string {
  const snippet = masked.text.split(/\n{2,}|\s{4,}/).slice(0, 6).join(" ").trim();
  const tags = Object.entries(masked.counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}×${n}`)
    .join(", ");
  const header = `📎 Auto-extracted from “${sourceName}” (masked PII + names + locations${tags ? ` — redacted: ${tags}` : ""}). Auto-deletes within 6 hours.`;
  return `${header}\n\n${snippet.slice(0, 1200)}${snippet.length > 1200 ? "…" : ""}`;
}
