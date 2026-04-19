/**
 * Drop an in-app notification into every webmaster's bell when an agent uses
 * the Call/Text Webmaster shortcut, AND ping the team's shared Slack channel
 * (when configured) so the on-call webmaster is alerted even with the app
 * closed. Mirrors `notifyAllUsers` but targets only `users` whose
 * `role == 'webmaster'` so we don't spam the whole team.
 *
 * The bell doc shape matches what /notifications already renders:
 *   { type: 'call' | 'message', title, description, link, read:false,
 *     isNote:false, broadcast:true, createdAt }
 *
 * `broadcast:true` + `read:false` is required by the Firestore rules to
 * permit cross-user writes (see `users/{uid}/notifications` rule).
 *
 * SECURITY: The Slack incoming-webhook URL is no longer accessible to the
 * browser. Both the Call/Text contextual ping and the standalone "Ping
 * Slack" alert are forwarded through Cloud Function callables
 * (`pingWebmasterSlackContextual` / `pingWebmasterSlack`) which read the
 * URL server-side from Firestore and apply rate limiting + role checks.
 */
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { logWebmasterContactEvent } from "@/lib/webmasterContactEvents";

export interface NotifyWebmasterInput {
  channel: "call" | "text";
  agentName: string;
  /** Caller's auth uid — required to satisfy the contact-events rules. */
  agentUid: string;
  /** Current route the agent is on, for instant context. */
  route: string;
}

/**
 * Send the fixed "review ConvoHub" alert to the team Slack channel via the
 * server-side proxy. Returns true on successful delivery, false otherwise
 * (e.g. webhook not configured, rate-limited, transient Slack error).
 *
 * NOTE: Rate limiting is enforced server-side; callers may also debounce
 * client-side for snappier UI but should treat the server's
 * `resource-exhausted` error as authoritative.
 */
export interface PingResult {
  ok: boolean;
  /** Epoch ms when the user is next allowed to fire an alert (rate limit). */
  nextAllowedAt?: number;
  /** Server error message when ok=false. */
  error?: string;
  /** True when the failure was a rate-limit hit (vs config / transient). */
  rateLimited?: boolean;
}

export async function pingWebmasterSlackAlert(input: {
  agentName: string; // ignored — server resolves identity from auth
  route: string;
}): Promise<PingResult> {
  try {
    const fn = httpsCallable<{ route: string }, { ok: boolean; sentAt: number; nextAllowedAt: number }>(
      functions,
      "pingWebmasterSlack"
    );
    const res = await fn({ route: input.route || "/" });
    return { ok: !!res.data.ok, nextAllowedAt: res.data.nextAllowedAt };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string; details?: { retryAt?: number } };
    const rateLimited = e.code === "functions/resource-exhausted" || e.code === "resource-exhausted";
    return {
      ok: false,
      rateLimited,
      nextAllowedAt: e.details?.retryAt,
      error: e.message,
    };
  }
}

export async function notifyWebmasterOnContact(input: NotifyWebmasterInput): Promise<number> {
  // Append-only contact log first — never blocks the OS hand-off.
  void logWebmasterContactEvent({
    agentUid: input.agentUid,
    agentName: input.agentName,
    channel: input.channel,
    route: input.route,
  });

  let snap;
  try {
    snap = await getDocs(query(collection(db, "users"), where("role", "==", "webmaster")));
  } catch (e) {
    console.warn("notifyWebmasterOnContact: could not list webmasters:", e);
    return 0;
  }
  const uids = snap.docs.map((d) => d.id).filter(Boolean);
  if (uids.length === 0) return 0;

  const channelLabel = input.channel === "call" ? "called" : "texted";
  const safeRoute = (input.route || "/").slice(0, 120);
  const title = `${input.agentName} ${channelLabel} you`;
  const description = `From ${safeRoute} · via the in-app webmaster shortcut.`;

  const batch = writeBatch(db);
  uids.forEach((uid) => {
    const ref = doc(collection(db, "users", uid, "notifications"));
    batch.set(ref, {
      type: input.channel === "call" ? "call" : "message",
      title,
      description,
      link: safeRoute,
      read: false,
      isNote: false,
      broadcast: true,
      createdAt: serverTimestamp(),
    });
  });
  try {
    await batch.commit();
    return uids.length;
  } catch (e) {
    console.warn("notifyWebmasterOnContact: batch failed:", e);
    return 0;
  }
}
