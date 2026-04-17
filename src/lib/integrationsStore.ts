import { doc, getDoc, setDoc, deleteField, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Per-user integrations store.
 * Path: users/{uid}/integrations/credentials  (single doc, fields keyed by integration id)
 *
 * NOTE on security: Firestore at-rest encryption is automatic. Per-user isolation is enforced
 * by Firestore security rules (users may only read/write their own users/{uid}/...). Secrets
 * are never returned to other users by this client. The UI masks secrets after save so they
 * are never re-displayed in plaintext.
 */

export type IntegrationId = "gmail" | "slack" | "google-voice" | "gmail-api";

export interface IntegrationConfig {
  fields: Record<string, string>;
  connected: boolean;
  updatedAt?: any;
}

const credsDocPath = (uid: string) => doc(db, "users", uid, "integrations", "credentials");

export async function loadAllIntegrations(uid: string): Promise<Record<string, IntegrationConfig>> {
  try {
    const snap = await getDoc(credsDocPath(uid));
    if (!snap.exists()) return {};
    const data = snap.data() as Record<string, IntegrationConfig>;
    return data || {};
  } catch (e) {
    console.error("loadAllIntegrations failed:", e);
    return {};
  }
}

export async function saveIntegration(
  uid: string,
  id: IntegrationId | string,
  fields: Record<string, string>,
  connected = true
): Promise<void> {
  await setDoc(
    credsDocPath(uid),
    {
      [id]: { fields, connected, updatedAt: serverTimestamp() },
    },
    { merge: true }
  );
}

export async function disconnectIntegration(uid: string, id: IntegrationId | string): Promise<void> {
  await setDoc(credsDocPath(uid), { [id]: deleteField() }, { merge: true });
}

/**
 * Notify Slack about a new email arrival. Posts to the configured Slack webhook URL.
 * Returns true on success, false on failure (silently logged — does not throw).
 */
export async function notifySlackNewEmail(
  webhookUrl: string,
  email: { from: string; subject: string; snippet: string }
): Promise<boolean> {
  if (!webhookUrl || !webhookUrl.startsWith("https://hooks.slack.com/")) return false;
  try {
    // Slack incoming webhooks accept JSON. Strip control chars to prevent injection.
    const safe = (s: string) => String(s).replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 500);
    const payload = {
      text: `:envelope_with_arrow: *New email* from ${safe(email.from)}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:envelope_with_arrow: *New email from ${safe(email.from)}*\n*${safe(email.subject)}*\n>${safe(email.snippet)}`,
          },
        },
      ],
    };
    // Slack webhooks return 200 OK with body "ok" on success. Use no-cors-friendly fetch.
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      mode: "no-cors", // Slack webhooks reject browser CORS preflight; fire-and-forget
    });
    return true;
  } catch (e) {
    console.error("Slack notify failed:", e);
    return false;
  }
}
