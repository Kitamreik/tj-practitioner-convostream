/**
 * Per-user UI preference helpers backed by localStorage.
 *
 * Keys are namespaced by Firebase UID so two users on the same device keep
 * separate preferences. All access is wrapped in try/catch because some
 * privacy modes (or quota errors) can throw on read/write.
 */

const NAMESPACE = "convohub.prefs";

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
}
