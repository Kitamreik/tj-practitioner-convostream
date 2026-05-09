/**
 * Managed-password local cache — DEPRECATED for security.
 *
 * Previously this module mirrored webmaster-managed user passwords into
 * `localStorage` so the webmaster could look them up offline. That created
 * an unacceptable XSS blast radius: any same-origin script (including a
 * dependency compromise) could enumerate every cached password with one
 * line of code.
 *
 * The Firestore `managedPasswords/{uid}` collection (webmaster-only via
 * rules) remains the source of truth. These exports are kept as no-ops so
 * existing call sites continue to compile, and we proactively purge any
 * legacy keys that were written by older builds.
 */

const KEY_PREFIX = "convohub.managedPassword.";

function purgeLegacyKeys(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) stale.push(k);
    }
    stale.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* private mode / storage disabled — nothing to do */
  }
}

// Best-effort cleanup at module load so old browsers stop holding plaintext.
purgeLegacyKeys();

export function setLocalManagedPassword(_uid: string, _password: string): void {
  /* no-op — passwords are never cached locally anymore */
}

export function getLocalManagedPassword(_uid: string): string | null {
  return null;
}

export function clearLocalManagedPassword(uid: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + uid);
  } catch {
    /* noop */
  }
}
