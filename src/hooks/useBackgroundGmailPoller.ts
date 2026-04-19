import { useEffect, useRef } from "react";
import { httpsCallable } from "firebase/functions";
import { useAuth } from "@/contexts/AuthContext";
import { functions } from "@/lib/firebase";
import { loadAllIntegrations } from "@/lib/integrationsStore";

/**
 * Background Gmail → ConvoHub poller.
 *
 * Runs whenever a webmaster is signed in with Gmail API credentials saved.
 * Every ~2 minutes it:
 *   1. Silently refreshes the Gmail OAuth access token (no popup — relies on
 *      the prior consent the webmaster gave on /gmail-api).
 *   2. Lists INBOX message ids more recent than the last seen id.
 *   3. For each new id fetches minimal headers and calls the existing
 *      `pushGmailMessageToConvoHub` callable, which dedups server-side on
 *      `gmail-msg:{id}` / `gmail-thread:{id}`.
 *
 * The hook is intentionally a no-op until consent has been granted at least
 * once on /gmail-api — there is no way to silently authorize a fresh user.
 *
 * Lives in a single React tree so two tabs of the app will both poll, but
 * the server dedup guarantees no duplicate Firestore writes.
 */

const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
].join(" ");

const POLL_MS = 2 * 60 * 1000;
const MAX_PER_TICK = 10;
// Per-uid set of message ids we've already pushed in this browser session.
// Server-side dedup is authoritative; this just avoids redundant network calls.
const SEEN_KEY = (uid: string) => `convohub.bgPoller.seen:${uid}`;

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

function loadSeen(uid: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY(uid));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveSeen(uid: string, seen: Set<string>) {
  try {
    // Cap the persisted set to avoid unbounded growth.
    const arr = Array.from(seen).slice(-500);
    sessionStorage.setItem(SEEN_KEY(uid), JSON.stringify(arr));
  } catch {
    /* noop — sessionStorage may be unavailable */
  }
}

function getHeader(headers: any[], name: string): string {
  const h = headers?.find((x: any) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

export function useBackgroundGmailPoller() {
  const { user, profile } = useAuth();
  const intervalRef = useRef<number | null>(null);
  const tokenClientRef = useRef<any>(null);
  const initializedRef = useRef(false);
  const inflightRef = useRef(false);

  useEffect(() => {
    if (!user || !profile) return;
    // Only webmasters poll in the background. Agents/admins continue to use
    // the manual Push to ConvoHub button on /gmail-api.
    if (profile.role !== "webmaster") return;

    let cancelled = false;
    const uid = user.uid;
    const seen = loadSeen(uid);

    const pushFn = httpsCallable<
      {
        messageId: string;
        threadId: string;
        from: string;
        fromEmail: string;
        subject: string;
        snippet: string;
      },
      { ok: boolean; conversationId: string; alreadyImported: boolean }
    >(functions, "pushGmailMessageToConvoHub");

    async function ensureInitialized(): Promise<{ clientId: string; apiKey: string } | null> {
      const all = await loadAllIntegrations(uid);
      const cfg = all["gmail-api"];
      const clientId = cfg?.fields?.clientId;
      const apiKey = cfg?.fields?.apiKey;
      if (!clientId || !apiKey) return null;

      if (!initializedRef.current) {
        await Promise.all([
          loadScript("https://apis.google.com/js/api.js"),
          loadScript("https://accounts.google.com/gsi/client"),
        ]);
        await new Promise<void>((res) => window.gapi.load("client", () => res()));
        await window.gapi.client.init({ apiKey, discoveryDocs: [DISCOVERY_DOC] });
        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPES,
          callback: () => {
            /* per-request callback set inside requestToken() */
          },
        });
        initializedRef.current = true;
      }
      return { clientId, apiKey };
    }

    function requestTokenSilently(): Promise<boolean> {
      return new Promise((resolve) => {
        const tc = tokenClientRef.current;
        if (!tc) {
          resolve(false);
          return;
        }
        tc.callback = (resp: any) => {
          if (resp?.error) {
            // Most common: "interaction_required" — webmaster must visit
            // /gmail-api once to grant consent. Stay silent in the background.
            resolve(false);
            return;
          }
          resolve(true);
        };
        try {
          // prompt: '' = silent re-issue using existing consent.
          tc.requestAccessToken({ prompt: "" });
        } catch {
          resolve(false);
        }
      });
    }

    async function tick() {
      if (cancelled || inflightRef.current) return;
      inflightRef.current = true;
      try {
        const ok = await ensureInitialized();
        if (!ok) return;

        // Make sure we have a fresh access token attached to gapi.
        const token = window.gapi.client.getToken?.();
        if (!token) {
          const granted = await requestTokenSilently();
          if (!granted) return; // user hasn't consented yet
        }

        const listResp = await window.gapi.client.gmail.users.messages.list({
          userId: "me",
          maxResults: MAX_PER_TICK,
          labelIds: ["INBOX"],
          q: "newer_than:1d",
        });
        const ids: { id: string }[] = listResp.result.messages || [];
        if (ids.length === 0) return;

        const fresh = ids.filter((m) => !seen.has(m.id));
        if (fresh.length === 0) return;

        for (const { id } of fresh) {
          if (cancelled) break;
          try {
            const msg = await window.gapi.client.gmail.users.messages.get({
              userId: "me",
              id,
              format: "metadata",
              metadataHeaders: ["From", "Subject"],
            });
            const headers = msg.result?.payload?.headers || [];
            const from = getHeader(headers, "From");
            const subject = getHeader(headers, "Subject") || "(no subject)";
            const snippet = msg.result?.snippet || "";
            const threadId = msg.result?.threadId || id;
            const fromEmail = (from.match(/<([^>]+)>/) || [])[1] || from;

            await pushFn({
              messageId: id,
              threadId,
              from,
              fromEmail,
              subject,
              snippet,
            });
            seen.add(id);
          } catch (e) {
            // Server already dedups, so on retry next tick the same id
            // will still be marked seen here to avoid hammering. Track
            // it so a single bad message doesn't loop forever.
            seen.add(id);
            // eslint-disable-next-line no-console
            console.warn("[gmail-poller] push failed", id, e);
          }
        }
        saveSeen(uid, seen);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[gmail-poller] tick failed", e);
      } finally {
        inflightRef.current = false;
      }
    }

    // Kick off after a short delay so it doesn't compete with first paint.
    const startTimer = window.setTimeout(() => {
      void tick();
      intervalRef.current = window.setInterval(() => void tick(), POLL_MS);
    }, 8_000);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [user, profile]);
}
