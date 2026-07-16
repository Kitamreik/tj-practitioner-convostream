/**
 * Customer portal enable/disable switch.
 *
 * Stored at `systemConfig/portal` with the shape `{ customerPortalEnabled: boolean }`.
 * Webmasters can toggle this from Settings; the public /portal/* routes and
 * the customer-facing CustomerRoute gate consult this value. Firestore rules
 * allow public read (so unauthenticated visitors on /portal/login see the
 * "portal closed" screen) and webmaster-only write.
 *
 * We also mirror the last-known value in localStorage so the UI can render an
 * immediate answer before the Firestore snapshot resolves — avoids a flash of
 * portal content when the portal is actually closed.
 */
import { doc, onSnapshot, setDoc, serverTimestamp, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

const DOC_PATH = { col: "systemConfig", id: "portal" } as const;
const LS_KEY = "ConvoHub.portalEnabled.v1";

export function getCachedPortalEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  const raw = localStorage.getItem(LS_KEY);
  if (raw === "0" || raw === "false") return false;
  return true;
}

function cache(enabled: boolean) {
  try { localStorage.setItem(LS_KEY, enabled ? "1" : "0"); } catch { /* noop */ }
}

export function subscribePortalEnabled(cb: (enabled: boolean) => void): () => void {
  // Cross-tab: any tab that writes the cache (via a Firestore snapshot or
  // an explicit setPortalEnabled) will also fire a `storage` event in every
  // OTHER open tab. Listening here means a signed-in customer sitting on a
  // portal route in a second tab flips to PortalClosed immediately, without
  // waiting for their own Firestore listener to receive the update.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== LS_KEY) return;
    cb(getCachedPortalEnabled());
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  const unsub = onSnapshot(
    doc(db, DOC_PATH.col, DOC_PATH.id),
    (snap) => {
      const enabled = snap.exists()
        ? (snap.data() as { customerPortalEnabled?: boolean }).customerPortalEnabled !== false
        : true;
      cache(enabled);
      cb(enabled);
    },
    (err) => {
      // Never leave the caller hanging — fall back to the cached value.
      console.warn("subscribePortalEnabled failed:", err);
      cb(getCachedPortalEnabled());
    }
  );
  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
    unsub();
  };
}

export async function setPortalEnabled(enabled: boolean, actorUid: string): Promise<void> {
  await setDoc(
    doc(db, DOC_PATH.col, DOC_PATH.id),
    {
      customerPortalEnabled: enabled,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    },
    { merge: true }
  );
  cache(enabled);
}

export async function readPortalEnabledOnce(): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, DOC_PATH.col, DOC_PATH.id));
    const enabled = snap.exists()
      ? (snap.data() as { customerPortalEnabled?: boolean }).customerPortalEnabled !== false
      : true;
    cache(enabled);
    return enabled;
  } catch {
    return getCachedPortalEnabled();
  }
}
