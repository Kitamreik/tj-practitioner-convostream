/**
 * Persistent undo queue for authorized-domain removals.
 *
 * When a webmaster removes a Firebase authorized domain the toast undo action
 * only lives as long as the toast itself. To recover from a removal that
 * turns out to be a mistake even AFTER navigating away from Settings, we
 * mirror the pending removal into localStorage with a 240s TTL. The global
 * `<PendingDomainUndoBanner />` reads this queue on every route and offers a
 * one-click restore until the window elapses.
 *
 * We intentionally keep this lib client-only — the actual re-add happens
 * through the `addAuthorizedDomain` callable, which enforces
 * `requireAdminOrWebmaster` server-side.
 */
export const UNDO_TTL_MS = 240_000; // 240 seconds
const STORAGE_KEY = "ConvoHub.authorizedDomain.undo.v1";
const EVENT = "convohub:authorized-domain-undo";

export interface PendingDomainUndo {
  domain: string;
  removedAt: number;
  expiresAt: number;
}

function safeRead(): PendingDomainUndo[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PendingDomainUndo =>
        !!e && typeof e.domain === "string" && typeof e.expiresAt === "number"
    );
  } catch {
    return [];
  }
}

function safeWrite(next: PendingDomainUndo[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* noop */
  }
}

/** Return all non-expired undo entries. Expired entries are pruned as a side effect. */
export function listPendingDomainUndos(now: number = Date.now()): PendingDomainUndo[] {
  const all = safeRead();
  const live = all.filter((e) => e.expiresAt > now);
  if (live.length !== all.length) safeWrite(live);
  return live;
}

export function queuePendingDomainUndo(domain: string, now: number = Date.now()): PendingDomainUndo {
  const entry: PendingDomainUndo = {
    domain,
    removedAt: now,
    expiresAt: now + UNDO_TTL_MS,
  };
  // Dedup by domain — the most recent removal wins.
  const others = safeRead().filter((e) => e.domain !== domain && e.expiresAt > now);
  safeWrite([...others, entry]);
  return entry;
}

export function clearPendingDomainUndo(domain: string): void {
  const next = safeRead().filter((e) => e.domain !== domain);
  safeWrite(next);
}

export function clearAllPendingDomainUndos(): void {
  safeWrite([]);
}

/**
 * Subscribe to changes in the pending-undo queue. Fires on write from this
 * tab (via CustomEvent) and on writes from other tabs (via `storage`).
 */
export function subscribePendingDomainUndos(cb: (entries: PendingDomainUndo[]) => void): () => void {
  const emit = () => cb(listPendingDomainUndos());
  emit();
  const onCustom = () => emit();
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) emit();
  };
  if (typeof window !== "undefined") {
    window.addEventListener(EVENT, onCustom);
    window.addEventListener("storage", onStorage);
  }
  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener(EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    }
  };
}
