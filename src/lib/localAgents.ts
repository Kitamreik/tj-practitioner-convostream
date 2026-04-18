/**
 * Local (client-side) agent roster.
 *
 * Webmasters can manually add agent entries that don't yet exist as Firestore
 * `users/{uid}` documents (e.g. agents that haven't signed up yet, or agents
 * managed externally). These are persisted in localStorage so they survive
 * reloads, and surfaced everywhere the app builds an "agents" list:
 *   - the Agents page roster
 *   - the assign-agent dropdown on Conversations
 *   - the Reassign targets list in Settings → Overview
 *
 * Storage key is intentionally global (not per-uid) because the agent roster
 * is a tenant-level concept — every webmaster on the device should see the
 * same list. Firestore rules still gate who can WRITE roles server-side; this
 * local store is purely a UI convenience.
 */
const STORAGE_KEY = "convohub.localAgents.v1";

export interface LocalAgent {
  /** Stable id — usually email-derived. Prefixed `local:` to avoid clashing
   *  with Firestore uids in the merged Agents list. */
  id: string;
  email: string;
  displayName: string;
  /** ISO timestamp the entry was created. */
  createdAt: string;
}

/** Defaults seeded on first load so the demo accounts always show up. */
const DEFAULTS: LocalAgent[] = [
  {
    id: "local:agent1@convohub.dev",
    email: "agent1@convohub.dev",
    displayName: "Agent One",
    createdAt: "2025-01-01T00:00:00.000Z",
  },
  {
    id: "local:agent2@convohub.dev",
    email: "agent2@convohub.dev",
    displayName: "Agent Two",
    createdAt: "2025-01-01T00:00:00.000Z",
  },
];

type Listener = (agents: LocalAgent[]) => void;
const listeners = new Set<Listener>();

function read(): LocalAgent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // First run on this device — seed with the defaults so the test agents
      // are immediately visible in the roster + assign dropdown.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULTS));
      return [...DEFAULTS];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULTS];
    return parsed.filter(
      (a): a is LocalAgent =>
        a && typeof a.email === "string" && typeof a.displayName === "string"
    );
  } catch {
    return [...DEFAULTS];
  }
}

function write(next: LocalAgent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / privacy mode — ignore */
  }
  listeners.forEach((fn) => {
    try {
      fn(next);
    } catch {
      /* ignore */
    }
  });
  // Cross-tab notification: storage events fire automatically in OTHER tabs,
  // but we also dispatch a local CustomEvent so same-tab subscribers update
  // even when they're using the storage-event path.
  try {
    window.dispatchEvent(new CustomEvent("convohub:localAgentsChanged"));
  } catch {
    /* ignore (non-browser env) */
  }
}

export function listLocalAgents(): LocalAgent[] {
  return read();
}

export function addLocalAgent(input: { email: string; displayName: string }): {
  ok: boolean;
  reason?: string;
  agent?: LocalAgent;
} {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (!email || !email.includes("@")) {
    return { ok: false, reason: "Enter a valid email address." };
  }
  if (!displayName) {
    return { ok: false, reason: "Display name is required." };
  }
  const current = read();
  if (current.some((a) => a.email.toLowerCase() === email)) {
    return { ok: false, reason: "An agent with that email already exists." };
  }
  const agent: LocalAgent = {
    id: `local:${email}`,
    email,
    displayName,
    createdAt: new Date().toISOString(),
  };
  write([agent, ...current]);
  return { ok: true, agent };
}

export function removeLocalAgent(id: string): void {
  write(read().filter((a) => a.id !== id));
}

/** Subscribe to changes (same tab + cross-tab via the storage event). */
export function subscribeLocalAgents(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener(read());
  };
  const onCustom = () => listener(read());
  window.addEventListener("storage", onStorage);
  window.addEventListener("convohub:localAgentsChanged", onCustom as EventListener);
  // Fire once immediately so consumers don't need a separate initial read.
  listener(read());
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(
      "convohub:localAgentsChanged",
      onCustom as EventListener
    );
  };
}
