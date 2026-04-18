/**
 * Configurable cooldown duration (minutes) between consecutive webmaster
 * contact attempts. Lives in Firestore at `appSettings/webmasterContact` so
 * the on-call webmaster can tune it from /settings during a high-volume
 * incident, with a localStorage fallback so the UI stays responsive when
 * Firestore is unreachable.
 */
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export const COOLDOWN_OPTIONS_MIN = [5, 15, 30, 60] as const;
export type CooldownMinutes = (typeof COOLDOWN_OPTIONS_MIN)[number];
export const DEFAULT_COOLDOWN_MIN: CooldownMinutes = 15;

const LOCAL_KEY = "convohub.webmasterCooldownMin";
const DOC_PATH = ["appSettings", "webmasterContact"] as const;

function isValid(n: unknown): n is CooldownMinutes {
  return typeof n === "number" && (COOLDOWN_OPTIONS_MIN as readonly number[]).includes(n);
}

export function getLocalCooldownMin(): CooldownMinutes {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const n = raw ? Number(raw) : NaN;
    if (isValid(n)) return n;
  } catch {
    /* ignore */
  }
  return DEFAULT_COOLDOWN_MIN;
}

function setLocalCooldownMin(value: CooldownMinutes): void {
  try { localStorage.setItem(LOCAL_KEY, String(value)); } catch { /* ignore */ }
}

/**
 * Subscribe to the team-wide cooldown setting. Hydrates synchronously from
 * localStorage and then keeps in sync with Firestore. Returns an unsub fn.
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
 * Persist a new cooldown duration. Webmaster-only (rules enforce). The
 * local mirror is updated regardless so the UI feels instant even when
 * Firestore is slow.
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
