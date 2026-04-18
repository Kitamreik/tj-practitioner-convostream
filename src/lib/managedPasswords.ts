/**
 * Webmaster-only helper for caching user passwords locally as a fallback
 * when Firestore is unreachable. The canonical store is the
 * `managedPasswords/{uid}` collection (webmaster-only via rules); this
 * mirror just keeps the value available offline so the webmaster can still
 * look it up after a network blip.
 *
 * IMPORTANT: only the webmaster's browser ever calls these helpers. Other
 * roles can't read the Firestore doc anyway, but we also gate the UI.
 */

const KEY_PREFIX = "convohub.managedPassword.";

export function setLocalManagedPassword(uid: string, password: string) {
  try {
    localStorage.setItem(KEY_PREFIX + uid, password);
  } catch {
    /* storage full / private mode — silent */
  }
}

export function getLocalManagedPassword(uid: string): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + uid);
  } catch {
    return null;
  }
}

export function clearLocalManagedPassword(uid: string) {
  try {
    localStorage.removeItem(KEY_PREFIX + uid);
  } catch {
    /* noop */
  }
}
