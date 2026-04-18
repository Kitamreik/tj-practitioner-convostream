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
import { db } from "@/lib/firebase";
import { getLocalSlackWebhookUrl } from "@/lib/webmasterCooldown";
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
 * Fire-and-forget Slack ping. Uses mode:'no-cors' because Slack incoming
 * webhooks reject browser preflight; the request still reaches Slack but we
 * can't read the response. Failures are swallowed — the in-app bell is the
 * source-of-truth fallback.
 */
async function pingSlack(input: NotifyWebmasterInput): Promise<boolean> {
  const url = getLocalSlackWebhookUrl();
  if (!url || !url.startsWith("https://hooks.slack.com/")) return false;
  // Strip control chars so an attacker-controlled name/route can't inject
  // unexpected blocks into the Slack payload.
  const safe = (s: string) => String(s).replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 240);
  const agent = safe(input.agentName);
  const route = safe(input.route || "/");
  const verb = input.channel === "call" ? "called" : "texted";
  const emoji = input.channel === "call" ? ":telephone_receiver:" : ":speech_balloon:";
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      mode: "no-cors",
      body: JSON.stringify({
        text: `${emoji} *${agent}* just ${verb} the webmaster from \`${route}\``,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${emoji} *${agent}* just ${verb} the webmaster\n>From \`${route}\` · via the in-app shortcut.`,
            },
          },
        ],
      }),
    });
    return true;
  } catch (e) {
    console.warn("notifyWebmasterOnContact: Slack ping failed:", e);
    return false;
  }
}

/**
 * Send the fixed "review ConvoHub" alert to the team Slack channel.
 * Used by the new Slack Alert button — no phone hand-off, no in-app bell
 * fan-out, no cooldown gate. Returns true on best-effort send (no-cors
 * means we can't read the response, but Slack still receives it).
 */
export async function pingWebmasterSlackAlert(input: {
  agentName: string;
  route: string;
}): Promise<boolean> {
  const url = getLocalSlackWebhookUrl();
  if (!url || !url.startsWith("https://hooks.slack.com/")) return false;
  const safe = (s: string) => String(s).replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 240);
  const agent = safe(input.agentName);
  const route = safe(input.route || "/");
  const message =
    "An agent has pinged this channel for review of the ConvoHub app. Please review or get Kit for scanning.";
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      mode: "no-cors",
      body: JSON.stringify({
        text: `:rotating_light: ${message} (from ${agent} · ${route})`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:rotating_light: *${message}*\n>From *${agent}* on \`${route}\``,
            },
          },
        ],
      }),
    });
    return true;
  } catch (e) {
    console.warn("pingWebmasterSlackAlert: Slack ping failed:", e);
    return false;
  }
}

export async function notifyWebmasterOnContact(input: NotifyWebmasterInput): Promise<number> {
  // Fire Slack + the append-only contact log in parallel with the bell
  // fan-out so a slow Firestore query can't delay the heads-up.
  void pingSlack(input);
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
