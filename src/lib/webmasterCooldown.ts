/**
 * Team-wide settings for the webmaster contact shortcuts. Lives in Firestore
 * at `appSettings/webmasterContact` so the on-call webmaster can tune them
 * from /settings during a high-volume incident, with localStorage fallbacks
 * so the UI stays responsive when Firestore is unreachable.
 *
 * Fields:
 *  - cooldownMinutes  (5/15/30/60) — gate between Call/Text taps.
 *  - slackWebhookUrl  (optional)   — incoming-webhook the system pings
 *    whenever an agent uses the Call/Text shortcut. Stored team-wide (not
 *    per-user) so every webmaster gets the alert via one Slack channel even
 *    when the agent can't read another user's private integration creds.
 */
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export const COOLDOWN_OPTIONS_MIN = [5, 15, 30, 60] as const;
export type CooldownMinutes = (typeof COOLDOWN_OPTIONS_MIN)[number];
export const DEFAULT_COOLDOWN_MIN: CooldownMinutes = 15;

const LOCAL_KEY_COOLDOWN = "convohub.webmasterCooldownMin";
const LOCAL_KEY_WEBHOOK = "convohub.webmasterSlackWebhookUrl";
const DOC_PATH = ["appSettings", "webmasterContact"] as const;

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

export function getLocalSlackWebhookUrl(): string {
  try {
    return localStorage.getItem(LOCAL_KEY_WEBHOOK) || "";
  } catch {
    return "";
  }
}

function setLocalSlackWebhookUrl(value: string): void {
  try { localStorage.setItem(LOCAL_KEY_WEBHOOK, value); } catch { /* ignore */ }
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
 * Subscribe to the team-wide Slack webhook URL. Empty string == not
 * configured; callers should silently skip the Slack ping in that case.
 */
export function subscribeSlackWebhookUrl(cb: (url: string) => void): () => void {
  cb(getLocalSlackWebhookUrl());
  const unsub = onSnapshot(
    doc(db, ...DOC_PATH),
    (snap) => {
      const data = snap.data() as { slackWebhookUrl?: string } | undefined;
      const url = (data?.slackWebhookUrl || "").trim();
      setLocalSlackWebhookUrl(url);
      cb(url);
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
 * Persist the team-wide Slack webhook URL. Empty string clears it.
 * Webmaster-only (rules enforce).
 */
export async function setSlackWebhookUrl(value: string, actorUid: string | null | undefined): Promise<void> {
  const cleaned = value.trim();
  if (cleaned && !cleaned.startsWith("https://hooks.slack.com/")) {
    throw new Error("URL must start with https://hooks.slack.com/");
  }
  setLocalSlackWebhookUrl(cleaned);
  await setDoc(
    doc(db, ...DOC_PATH),
    {
      slackWebhookUrl: cleaned,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid ?? null,
    },
    { merge: true }
  );
}
