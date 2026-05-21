/**
 * Read-only agent session mirror.
 *
 * Each signed-in internal teammate writes their current presence to
 * `agentSessions/{uid}`:
 *   - route: window.location.pathname
 *   - conversationId / chatThreadId when on a thread route
 *   - lastActionAt: serverTimestamp updated on route change or explicit ping
 *   - userAgent + viewport for debugging
 *
 * Webmasters read this collection on /agent-sessions to troubleshoot what
 * an agent is currently seeing without screen-pixel capture. There is NO
 * remote control surface — this is a passive mirror only.
 *
 * Writes are throttled to once every 5s to avoid Firestore write storms
 * on rapid route changes (sidebar nav clicks, hash updates, etc.).
 */
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface AgentSession {
  uid: string;
  displayName?: string;
  email?: string;
  role?: string;
  route: string;
  conversationId?: string | null;
  chatThreadId?: string | null;
  userAgent?: string;
  viewport?: { w: number; h: number };
  lastActionAt?: Timestamp | null;
  startedAt?: Timestamp | null;
}

const THROTTLE_MS = 5_000;
let lastWriteAt = 0;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/** Write the caller's current presence row. Throttled. */
export function publishPresence(input: {
  uid: string;
  displayName?: string;
  email?: string;
  role?: string;
  route: string;
  conversationId?: string | null;
  chatThreadId?: string | null;
}): void {
  const now = Date.now();
  const elapsed = now - lastWriteAt;

  const write = () => {
    lastWriteAt = Date.now();
    const ref = doc(db, "agentSessions", input.uid);
    setDoc(
      ref,
      {
        uid: input.uid,
        displayName: input.displayName ?? "",
        email: input.email ?? "",
        role: input.role ?? "",
        route: input.route,
        conversationId: input.conversationId ?? null,
        chatThreadId: input.chatThreadId ?? null,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        viewport:
          typeof window !== "undefined"
            ? { w: window.innerWidth, h: window.innerHeight }
            : { w: 0, h: 0 },
        lastActionAt: serverTimestamp(),
        startedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch((err) => console.warn("publishPresence failed:", err));
  };

  if (elapsed >= THROTTLE_MS) {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    write();
  } else if (!pendingTimer) {
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      write();
    }, THROTTLE_MS - elapsed);
  }
}

/** Webmaster-only: live list of every agent's current session. */
export function subscribeAgentSessions(
  cb: (rows: AgentSession[]) => void
): () => void {
  return onSnapshot(
    collection(db, "agentSessions"),
    (snap) => {
      const rows = snap.docs.map((d) => ({
        uid: d.id,
        ...(d.data() as Omit<AgentSession, "uid">),
      }));
      rows.sort((a, b) => {
        const am = a.lastActionAt?.toMillis?.() ?? 0;
        const bm = b.lastActionAt?.toMillis?.() ?? 0;
        return bm - am;
      });
      cb(rows);
    },
    (err) => {
      console.warn("subscribeAgentSessions error:", err);
      cb([]);
    }
  );
}
