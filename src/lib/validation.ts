import { z } from "zod";

/**
 * Centralized Zod schemas + sanitization helpers for all user-facing forms.
 * Goals: protect against injection (SQL, XSS, header-injection, command), enforce
 * length limits, and normalize whitespace before persisting anything.
 */

// Strip control chars (0x00–0x1F except \n\r\t) that can be used for header / log injection
const stripControl = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

export const sanitizeText = (s: string): string => stripControl(s).trim();

// Allow only single-line strings (used for emails, names, IDs). Strips newlines.
export const singleLine = (s: string): string => sanitizeText(s).replace(/[\r\n]+/g, " ");

// Email: trim, lowercase, length-bounded, valid format.
export const emailSchema = z
  .string()
  .transform((v) => singleLine(v).toLowerCase())
  .pipe(z.string().email("Invalid email address").max(254, "Email too long"));

// Phone: digits, spaces, dashes, parens, plus only — max 32 chars.
export const phoneSchema = z
  .string()
  .transform((v) => singleLine(v))
  .pipe(
    z.string().max(32, "Phone too long").regex(/^[+()\-\s\d]*$/, "Phone can only contain digits, spaces, +, -, ()")
  );

// Display name: 1-80 chars, no control chars, no angle brackets (XSS).
export const nameSchema = z
  .string()
  .transform((v) => singleLine(v))
  .pipe(z.string().min(1, "Name is required").max(80, "Name too long").regex(/^[^<>]*$/, "Name contains invalid characters"));

// Tags: comma-separated string → array. Each tag 1-30 chars, alphanumeric + dash/space.
export const tagsSchema = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").map((t) => sanitizeText(t)).filter(Boolean) : []))
  .pipe(z.array(z.string().min(1).max(30).regex(/^[\w\s\-]+$/, "Invalid tag characters")).max(20, "Too many tags"));

// OAuth Client ID for Google: <id>.apps.googleusercontent.com
export const googleClientIdSchema = z
  .string()
  .transform((v) => singleLine(v))
  .pipe(z.string().min(10).max(200).regex(/^[\w\-]+\.apps\.googleusercontent\.com$/, "Must end with .apps.googleusercontent.com"));

// Google API key: typical AIza prefix, 35-100 chars, [A-Za-z0-9_-]
export const googleApiKeySchema = z
  .string()
  .transform((v) => singleLine(v))
  .pipe(z.string().min(20).max(200).regex(/^[A-Za-z0-9_\-]+$/, "Invalid API key format"));

// Generic OAuth secret (Google "GOCSPX-...") — printable ASCII, no spaces.
export const oauthSecretSchema = z
  .string()
  .transform((v) => singleLine(v))
  .pipe(z.string().min(8).max(200).regex(/^\S+$/, "Secret cannot contain whitespace"));

// Generic URL with https only (used for Slack webhook, redirect URI).
export const httpsUrlSchema = z
  .string()
  .transform((v) => singleLine(v))
  .pipe(
    z
      .string()
      .url("Must be a valid URL")
      .max(500)
      .refine((u) => u.startsWith("https://"), "URL must use https://")
  );

// Slack channel name (#general or general) — 1-80 chars, lowercase, dash/underscore.
export const slackChannelSchema = z
  .string()
  .transform((v) => singleLine(v).replace(/^#/, "").toLowerCase())
  .pipe(z.string().min(1).max(80).regex(/^[a-z0-9_\-]+$/, "Use lowercase letters, numbers, dashes, underscores"));

// Slack bot token (xoxb-...) — optional in some flows.
export const slackBotTokenSchema = z
  .string()
  .transform((v) => singleLine(v))
  .pipe(z.string().min(20).max(300).regex(/^xox[baprs]-[\w\-]+$/, "Invalid Slack token format"));

// Free-form message body — strip control chars, cap length.
export const messageBodySchema = z
  .string()
  .transform((v) => sanitizeText(v))
  .pipe(z.string().min(1, "Message cannot be empty").max(10_000, "Message too long"));

// Subject line — single line, capped.
export const subjectSchema = z
  .string()
  .transform((v) => singleLine(v))
  .pipe(z.string().min(1, "Subject is required").max(200, "Subject too long"));

// Mask any sensitive value for display: show first 4 + last 4 chars.
export const maskSecret = (value: string | undefined | null): string => {
  if (!value) return "";
  const v = String(value);
  if (v.length <= 8) return "•".repeat(v.length);
  return `${v.slice(0, 4)}${"•".repeat(Math.min(v.length - 8, 16))}${v.slice(-4)}`;
};

// Helper: run a Zod schema and return either the parsed value or a friendly error message.
export type ValidateResult<T> = { ok: true; data: T; error?: undefined } | { ok: false; error: string; data?: undefined };

export function safeValidate<T>(schema: z.ZodType<T, any, any>, value: unknown): ValidateResult<T> {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  const first = result.error.errors[0];
  return { ok: false, error: first?.message || "Invalid input" };
}

