/**
 * Per-user UI preference helpers.
 *
 * Two storage tiers:
 *   1. **localStorage** — fast, synchronous, per-device. Used for ephemeral or
 *      device-specific toggles (e.g. "mute team broadcasts on this laptop").
 *   2. **Firestore** (`users/{uid}/prefs/ui`) — slower, async, but follows the
 *      user across devices. Used for prefs that should be sticky regardless
 *      of where the user signs in (e.g. background Gmail ingestion).
 *
 * Keys are namespaced by Firebase UID so two users on the same device keep
 * separate preferences. All localStorage access is wrapped in try/catch
 * because some privacy modes (or quota errors) can throw on read/write.
 *
 * A lightweight pub/sub layer lets components (e.g. the bell-icon mute dot
 * in the top nav) react instantly when the user flips a toggle on another
 * page, without waiting for a remount.
 */

import { doc, onSnapshot, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

const NAMESPACE = "convohub.prefs";
const EVENT_NAME = "convohub:pref-change";

function makeKey(uid: string | null | undefined, key: string): string {
  return `${NAMESPACE}:${uid || "anon"}:${key}`;
}

// ---------------------------------------------------------------------------
// Local (per-device) prefs — unchanged API.
// ---------------------------------------------------------------------------

export function getBoolPref(uid: string | null | undefined, key: string, fallback = false): boolean {
  try {
    const raw = localStorage.getItem(makeKey(uid, key));
    if (raw === null) return fallback;
    return raw === "1" || raw === "true";
  } catch {
    return fallback;
  }
}

export function setBoolPref(uid: string | null | undefined, key: string, value: boolean): void {
  try {
    localStorage.setItem(makeKey(uid, key), value ? "1" : "0");
  } catch {
    /* ignore quota / privacy mode failures */
  }
  // Notify in-tab listeners. (`storage` events only fire in *other* tabs, so
  // we dispatch a custom event for same-tab subscribers.)
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { uid: uid || "anon", key, value } }));
  } catch {
    /* ignore — non-browser env */
  }
}

/**
 * Subscribe to changes for a specific (uid, key) bool pref. Fires immediately
 * on cross-tab `storage` events too. Returns an unsubscribe function.
 */
export function subscribeBoolPref(
  uid: string | null | undefined,
  key: string,
  cb: (value: boolean) => void
): () => void {
  const targetUid = uid || "anon";
  const fullKey = makeKey(uid, key);
  const onCustom = (e: Event) => {
    const detail = (e as CustomEvent).detail as { uid?: string; key?: string; value?: boolean } | undefined;
    if (!detail) return;
    if (detail.uid === targetUid && detail.key === key) cb(!!detail.value);
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== fullKey) return;
    cb(e.newValue === "1" || e.newValue === "true");
  };
  window.addEventListener(EVENT_NAME, onCustom as EventListener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, onCustom as EventListener);
    window.removeEventListener("storage", onStorage);
  };
}

// ---------------------------------------------------------------------------
// Remote (cross-device) prefs — Firestore-backed at users/{uid}/prefs/ui.
// ---------------------------------------------------------------------------
//
// Stored as a single doc with one field per pref so we don't need a separate
// document per key (kept the doc name "ui" so future text/number prefs can
// live alongside booleans). Writes use `setDoc(..., { merge: true })` so
// flipping one toggle never clobbers the others.

const REMOTE_DOC_ID = "ui";

function remotePrefDocPath(uid: string) {
  // users/{uid}/prefs/ui
  return doc(db, "users", uid, "prefs", REMOTE_DOC_ID);
}

/**
 * One-shot read of a Firestore-backed bool pref. Falls back to a local
 * pref if the remote doc doesn't exist yet (handles the migration window
 * where a user already had a localStorage value but no Firestore mirror).
 */
export async function getBoolPrefRemote(
  uid: string | null | undefined,
  key: string,
  fallback = false
): Promise<boolean> {
  if (!uid) return getBoolPref(uid, key, fallback);
  try {
    const snap = await getDoc(remotePrefDocPath(uid));
    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      if (key in data) return data[key] === true;
    }
  } catch {
    /* fall through to local */
  }
  return getBoolPref(uid, key, fallback);
}

/**
 * Write a Firestore-backed bool pref. Also mirrors to localStorage so the
 * existing local pub/sub fires immediately (snappy UI) and so first-paint
 * after a refresh has a value before the Firestore listener resolves.
 */
export async function setBoolPrefRemote(
  uid: string | null | undefined,
  key: string,
  value: boolean
): Promise<void> {
  // Mirror locally first — instant in-tab pub/sub, plus a usable cache.
  setBoolPref(uid, key, value);
  if (!uid) return;
  try {
    await setDoc(
      remotePrefDocPath(uid),
      { [key]: value, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (e) {
    console.warn(`setBoolPrefRemote(${key}) failed:`, e);
  }
}

/**
 * Subscribe to a Firestore-backed bool pref via `onSnapshot`. Fires once
 * with the current value (or the fallback if missing) and then on every
 * remote change. Also seeds localStorage on the first remote read so
 * cross-tab `storage` listeners and synchronous `getBoolPref` consumers
 * stay in sync.
 *
 * One-time migration: if the remote doc is missing the key but a local
 * value exists, we push the local value up so the user's choice on the
 * old device follows them to new ones.
 */
export function subscribeBoolPrefRemote(
  uid: string | null | undefined,
  key: string,
  cb: (value: boolean) => void,
  fallback = false
): () => void {
  if (!uid) {
    cb(getBoolPref(uid, key, fallback));
    // Still subscribe to local changes so anonymous-mode UI stays reactive.
    return subscribeBoolPref(uid, key, cb);
  }

  let migrated = false;
  const unsubRemote = onSnapshot(
    remotePrefDocPath(uid),
    (snap) => {
      if (snap.exists()) {
        const data = snap.data() as Record<string, unknown>;
        if (key in data) {
          const v = data[key] === true;
          // Mirror to localStorage so synchronous reads + cross-tab
          // listeners reflect the canonical remote value.
          setBoolPref(uid, key, v);
          cb(v);
          return;
        }
      }
      // Doc missing OR field absent — migrate from local if present.
      const local = getBoolPref(uid, key, fallback);
      cb(local);
      if (!migrated && (local !== fallback || snap.exists() === false)) {
        migrated = true;
        // Fire-and-forget; failures are logged and the local value still
        // works so the user sees no interruption.
        setBoolPrefRemote(uid, key, local).catch(() => {
          /* logged inside */
        });
      }
    },
    (err) => {
      console.warn(`subscribeBoolPrefRemote(${key}) listener error:`, err);
      cb(getBoolPref(uid, key, fallback));
    }
  );

  // Also pipe local same-tab updates so the subscriber gets instant feedback
  // before the Firestore round-trip completes when the user flips the toggle.
  const unsubLocal = subscribeBoolPref(uid, key, cb);

  return () => {
    unsubRemote();
    unsubLocal();
  };
}
