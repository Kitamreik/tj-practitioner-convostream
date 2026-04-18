/**
 * Per-user UI preference helpers backed by localStorage.
 *
 * Keys are namespaced by Firebase UID so two users on the same device keep
 * separate preferences. All access is wrapped in try/catch because some
 * privacy modes (or quota errors) can throw on read/write.
 *
 * A lightweight pub/sub layer lets components (e.g. the bell-icon mute dot
 * in the top nav) react instantly when the user flips a toggle on another
 * page, without waiting for a remount.
 */

const NAMESPACE = "convohub.prefs";
const EVENT_NAME = "convohub:pref-change";

function makeKey(uid: string | null | undefined, key: string): string {
  return `${NAMESPACE}:${uid || "anon"}:${key}`;
}

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
