/**
 * Team-wide settings for the webmaster contact shortcuts. Lives in Firestore
 * at `appSettings/webmasterContact` so the on-call webmaster can tune them
 * from /settings during a high-volume incident, with localStorage fallbacks
 * so the UI stays responsive when Firestore is unreachable.
 *
 * Fields:
 *  - cooldownMinutes  (5/15/30/60) — gate between Call/Text taps.
 *  - slackWebhookUrl  (optional)   — incoming-webhook the system pings.
 *    SECURITY: As of the Slack-proxy migration this URL is no longer read by
 *    the browser at all — the `pingWebmasterSlack` Cloud Function fetches it
 *    server-side. Clients only see whether it's configured via the public
 *    `appSettings/slackAlertStatus.configured` boolean.
 */
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";

export const COOLDOWN_OPTIONS_MIN = [5, 15, 30, 60] as const;
export type CooldownMinutes = (typeof COOLDOWN_OPTIONS_MIN)[number];
export const DEFAULT_COOLDOWN_MIN: CooldownMinutes = 15;

const LOCAL_KEY_COOLDOWN = "convohub.webmasterCooldownMin";
const LOCAL_KEY_WEBHOOK_CONFIGURED = "convohub.slackAlertConfigured";
const DOC_PATH = ["appSettings", "webmasterContact"] as const;
const STATUS_DOC_PATH = ["appSettings", "slackAlertStatus"] as const;

function isValid(n: unknown): n is CooldownMinutes {
  return typeof n === "number" && (COOLDOWN_OPTIONS_MIN as readonly number[]).includes(n);
}

export function getLocalCooldownMin(): CooldownMinutes {
  try {
    const raw = localStorage.getItem(LOCAL_KEY_COOLDOWN);
    const n = raw ? Number(raw) : NaN;
    if (isValid(n)) return n;
  } catch {
    /* ignore */
  }
  return DEFAULT_COOLDOWN_MIN;
}

function setLocalCooldownMin(value: CooldownMinutes): void {
  try { localStorage.setItem(LOCAL_KEY_COOLDOWN, String(value)); } catch { /* ignore */ }
}

/**
 * Subscribe to the team-wide cooldown. Hydrates synchronously from
 * localStorage then keeps in sync with Firestore. Returns an unsub fn.
 */
export function subscribeCooldownMin(cb: (mins: CooldownMinutes) => void): () => void {
  cb(getLocalCooldownMin());
  const unsub = onSnapshot(
    doc(db, ...DOC_PATH),
    (snap) => {
      const data = snap.data() as { cooldownMinutes?: number } | undefined;
      const n = data?.cooldownMinutes;
      if (isValid(n)) {
        setLocalCooldownMin(n);
        cb(n);
      }
    },
    () => {
      /* permission/network — keep last known local value */
    }
  );
  return unsub;
}

/**
 * Boolean mirror of `appSettings/slackAlertStatus.configured`. Lets the
 * SlackAlertButton enable/disable itself without ever loading the secret URL.
 */
export function getLocalSlackAlertConfigured(): boolean {
  try {
    return localStorage.getItem(LOCAL_KEY_WEBHOOK_CONFIGURED) === "1";
  } catch {
    return false;
  }
}

function setLocalSlackAlertConfigured(value: boolean): void {
  try {
    localStorage.setItem(LOCAL_KEY_WEBHOOK_CONFIGURED, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function subscribeSlackAlertConfigured(cb: (configured: boolean) => void): () => void {
  cb(getLocalSlackAlertConfigured());
  const unsub = onSnapshot(
    doc(db, ...STATUS_DOC_PATH),
    (snap) => {
      const data = snap.data() as { configured?: boolean } | undefined;
      const configured = !!data?.configured;
      setLocalSlackAlertConfigured(configured);
      cb(configured);
    },
    () => {
      /* permission/network — keep last known local value */
    }
  );
  return unsub;
}

/**
 * Persist a new cooldown duration. Webmaster-only (rules enforce). The
 * local mirror is updated regardless so the UI feels instant.
 */
export async function setCooldownMin(value: CooldownMinutes, actorUid: string | null | undefined): Promise<void> {
  if (!isValid(value)) throw new Error(`Invalid cooldown: ${value}`);
  setLocalCooldownMin(value);
  await setDoc(
    doc(db, ...DOC_PATH),
    {
      cooldownMinutes: value,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid ?? null,
    },
    { merge: true }
  );
}

/**
 * Persist the team-wide Slack webhook URL through the server-side proxy
 * (`setSlackWebhookUrlAdmin` callable). The URL never lands in the browser
 * bundle — only the server stores and uses it. Pass an empty string to
 * clear the configuration.
 *
 * Caller must be admin or webmaster (function enforces).
 */
export async function setSlackWebhookUrl(value: string): Promise<{ configured: boolean }> {
  const cleaned = value.trim();
  if (cleaned && !cleaned.startsWith("https://hooks.slack.com/")) {
    throw new Error("URL must start with https://hooks.slack.com/");
  }
  const fn = httpsCallable<{ url: string }, { ok: boolean; configured: boolean }>(
    functions,
    "setSlackWebhookUrlAdmin"
  );
  const res = await fn({ url: cleaned });
  setLocalSlackAlertConfigured(!!res.data.configured);
  return { configured: !!res.data.configured };
}
