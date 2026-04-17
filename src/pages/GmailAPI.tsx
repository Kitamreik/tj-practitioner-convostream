import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail,
  LogIn,
  LogOut,
  RefreshCw,
  Tag,
  AlertCircle,
  Inbox,
  ArrowLeft,
  Paperclip,
  Clock,
  Send,
  Pencil,
  Reply,
  Lock,
  CheckCircle2,
  Wifi,
  MailCheck,
} from "lucide-react";
import DOMPurify from "dompurify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import {
  loadAllIntegrations,
  saveIntegration,
  notifySlackNewEmail,
} from "@/lib/integrationsStore";
import {
  emailSchema,
  subjectSchema,
  messageBodySchema,
  googleClientIdSchema,
  googleApiKeySchema,
  maskSecret,
  safeValidate,
  singleLine,
} from "@/lib/validation";

const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest";
// Need send + readonly + modify for compose/reply. Compose scope is preferable to full mail.
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
].join(" ");

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

interface GmailLabel {
  id: string;
  name: string;
  type: string;
}

interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body: string;
  hasAttachments: boolean;
  labelIds: string[];
}

function decodeBase64Url(str: string): string {
  try {
    const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    return decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
  } catch {
    return str;
  }
}

function encodeBase64Url(str: string): string {
  // utf-8 safe → base64url
  const utf8 = new TextEncoder().encode(str);
  let binary = "";
  utf8.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getHeader(headers: any[], name: string): string {
  const h = headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

function extractBody(payload: any): string {
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  if (payload.parts) {
    const htmlPart = payload.parts.find((p: any) => p.mimeType === "text/html");
    if (htmlPart?.body?.data) return decodeBase64Url(htmlPart.body.data);
    const textPart = payload.parts.find((p: any) => p.mimeType === "text/plain");
    if (textPart?.body?.data) return decodeBase64Url(textPart.body.data);
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }
  return "";
}

function hasAttachments(payload: any): boolean {
  if (payload.parts) {
    return payload.parts.some((p: any) => p.filename && p.filename.length > 0);
  }
  return false;
}

// Build an RFC 2822 message safely. Strip CRLF from headers (header injection).
function buildRawEmail(opts: {
  to: string;
  from?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const safeHeader = (s: string) => String(s).replace(/[\r\n]+/g, " ");
  const lines = [
    `To: ${safeHeader(opts.to)}`,
    opts.from ? `From: ${safeHeader(opts.from)}` : "",
    `Subject: ${safeHeader(opts.subject)}`,
    opts.inReplyTo ? `In-Reply-To: ${safeHeader(opts.inReplyTo)}` : "",
    opts.references ? `References: ${safeHeader(opts.references)}` : "",
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0",
    "",
    opts.body,
  ].filter(Boolean);
  return encodeBase64Url(lines.join("\r\n"));
}

const GmailAPI: React.FC = () => {
  const { user } = useAuth();
  const [clientId, setClientId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [credsSaved, setCredsSaved] = useState(false);
  const [credsLoading, setCredsLoading] = useState(true);
  const [editingCreds, setEditingCreds] = useState(false);
  const [savedClientIdMask, setSavedClientIdMask] = useState("");
  const [savedApiKeyMask, setSavedApiKeyMask] = useState("");
  const [slackWebhook, setSlackWebhook] = useState<string>("");
  const [knownMessageIds, setKnownMessageIds] = useState<Set<string>>(new Set());
  const firstLoadRef = useRef(true);

  const [gapiInited, setGapiInited] = useState(false);
  const [gisInited, setGisInited] = useState(false);
  const [clientReady, setClientReady] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<GmailMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"labels" | "messages">("messages");
  const tokenClientRef = useRef<any>(null);
  const scriptsLoadedRef = useRef(false);

  // Compose / Reply dialog state
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<"new" | "reply">("new");
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [replyContext, setReplyContext] = useState<{ messageIdHeader: string; threadId: string; references: string } | null>(null);

  // Load Google scripts once
  useEffect(() => {
    if (scriptsLoadedRef.current) return;
    scriptsLoadedRef.current = true;
    const loadScript = (src: string, onload: () => void) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.defer = true;
      script.onload = onload;
      document.head.appendChild(script);
    };
    loadScript("https://apis.google.com/js/api.js", () => {
      window.gapi.load("client", () => setGapiInited(true));
    });
    loadScript("https://accounts.google.com/gsi/client", () => {
      setGisInited(true);
    });
  }, []);

  // Load saved creds + Slack webhook from Firestore
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await loadAllIntegrations(user.uid);
        if (cancelled) return;
        const gmailCfg = all["gmail-api"];
        if (gmailCfg?.fields?.clientId && gmailCfg?.fields?.apiKey) {
          setClientId(gmailCfg.fields.clientId);
          setApiKey(gmailCfg.fields.apiKey);
          setSavedClientIdMask(maskSecret(gmailCfg.fields.clientId));
          setSavedApiKeyMask(maskSecret(gmailCfg.fields.apiKey));
          setCredsSaved(true);
        }
        const slack = all["slack"];
        if (slack?.fields?.webhookUrl) {
          setSlackWebhook(slack.fields.webhookUrl);
        }
      } finally {
        if (!cancelled) setCredsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const ready = gapiInited && gisInited;

  // Auto-initialize the client as soon as creds + scripts are ready.
  // This is the bug-fix for "Authorize button doesn't render after creds entered":
  // previously the user had to click an explicit Initialize button. Now we do it for them.
  useEffect(() => {
    if (!ready) return;
    if (!clientId || !apiKey) return;
    if (clientReady) return;
    let cancelled = false;
    (async () => {
      try {
        await window.gapi.client.init({ apiKey, discoveryDocs: [DISCOVERY_DOC] });
        if (cancelled) return;
        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPES,
          callback: "",
        });
        setClientReady(true);
        setError(null);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to initialize Gmail client");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, clientId, apiKey, clientReady]);

  const handleSaveCreds = useCallback(async () => {
    if (!user) {
      toast({ title: "Not signed in", variant: "destructive" });
      return;
    }
    const cidV = safeValidate(googleClientIdSchema, clientId);
    if (!cidV.ok) {
      toast({ title: "Invalid Client ID", description: cidV.error, variant: "destructive" });
      return;
    }
    const akV = safeValidate(googleApiKeySchema, apiKey);
    if (!akV.ok) {
      toast({ title: "Invalid API Key", description: akV.error, variant: "destructive" });
      return;
    }

    try {
      await saveIntegration(user.uid, "gmail-api", { clientId: cidV.data, apiKey: akV.data }, true);
      setClientId(cidV.data);
      setApiKey(akV.data);
      setSavedClientIdMask(maskSecret(cidV.data));
      setSavedApiKeyMask(maskSecret(akV.data));
      setCredsSaved(true);
      setEditingCreds(false);
      // Force re-init with new values
      setClientReady(false);
      toast({ title: "Credentials saved", description: "Gmail API credentials stored securely." });
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    }
  }, [user, clientId, apiKey]);

  const fetchLabels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await window.gapi.client.gmail.users.labels.list({ userId: "me" });
      const result = response.result.labels || [];
      setLabels(result.map((l: any) => ({ id: l.id, name: l.name, type: l.type || "user" })));
    } catch (err: any) {
      setError(err?.message || "Failed to fetch labels");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMessages = useCallback(async () => {
    setLoadingMessages(true);
    setError(null);
    try {
      const listResp = await window.gapi.client.gmail.users.messages.list({
        userId: "me",
        maxResults: 20,
        labelIds: ["INBOX"],
      });
      const messageIds = listResp.result.messages || [];
      if (messageIds.length === 0) {
        setMessages([]);
        return;
      }

      const batch = window.gapi.client.newBatch();
      messageIds.forEach((m: any) => {
        batch.add(
          window.gapi.client.gmail.users.messages.get({ userId: "me", id: m.id, format: "full" }),
          { id: m.id }
        );
      });

      const batchResp = await batch;
      const parsed: GmailMessage[] = [];
      for (const key of Object.keys(batchResp.result)) {
        const msg = batchResp.result[key].result;
        if (!msg?.payload) continue;
        const headers = msg.payload.headers || [];
        parsed.push({
          id: msg.id,
          threadId: msg.threadId,
          subject: getHeader(headers, "Subject") || "(no subject)",
          from: getHeader(headers, "From"),
          date: getHeader(headers, "Date"),
          snippet: msg.snippet || "",
          body: extractBody(msg.payload),
          hasAttachments: hasAttachments(msg.payload),
          labelIds: msg.labelIds || [],
        });
      }
      parsed.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setMessages(parsed);

      // Slack notification for newly seen inbound messages (skip first load)
      if (slackWebhook && !firstLoadRef.current) {
        const newOnes = parsed.filter((m) => !knownMessageIds.has(m.id) && m.labelIds.includes("INBOX"));
        for (const m of newOnes.slice(0, 5)) {
          // sanitize before sending — no HTML, no control chars
          notifySlackNewEmail(slackWebhook, {
            from: singleLine(m.from),
            subject: singleLine(m.subject),
            snippet: singleLine(m.snippet),
          });
        }
      }
      setKnownMessageIds(new Set(parsed.map((m) => m.id)));
      firstLoadRef.current = false;
    } catch (err: any) {
      setError(err?.message || "Failed to fetch messages");
    } finally {
      setLoadingMessages(false);
    }
  }, [slackWebhook, knownMessageIds]);

  const handleAuth = useCallback(() => {
    if (!tokenClientRef.current) {
      toast({ title: "Not initialized", description: "Save credentials first.", variant: "destructive" });
      return;
    }
    tokenClientRef.current.callback = async (resp: any) => {
      if (resp.error) {
        setError(resp.error);
        return;
      }
      setAuthorized(true);
      setError(null);
      toast({ title: "Authorized", description: "Gmail access granted." });
      await Promise.all([fetchLabels(), fetchMessages()]);
    };
    if (window.gapi.client.getToken() === null) {
      tokenClientRef.current.requestAccessToken({ prompt: "consent" });
    } else {
      tokenClientRef.current.requestAccessToken({ prompt: "" });
    }
  }, [fetchLabels, fetchMessages]);

  const handleSignout = useCallback(() => {
    const token = window.gapi.client.getToken();
    if (token) {
      window.google.accounts.oauth2.revoke(token.access_token);
      window.gapi.client.setToken("");
    }
    setAuthorized(false);
    setLabels([]);
    setMessages([]);
    setSelectedMessage(null);
    toast({ title: "Signed out" });
  }, []);

  // ----- Compose / Reply -----

  const openCompose = () => {
    setComposeMode("new");
    setReplyContext(null);
    setComposeTo("");
    setComposeSubject("");
    setComposeBody("");
    setComposeOpen(true);
  };

  const openReply = (msg: GmailMessage) => {
    setComposeMode("reply");
    // Reply-To header would be ideal; fall back to From.
    const fromEmail = (msg.from.match(/<([^>]+)>/) || [])[1] || msg.from;
    const subj = msg.subject.startsWith("Re:") ? msg.subject : `Re: ${msg.subject}`;
    setComposeTo(fromEmail);
    setComposeSubject(subj);
    setComposeBody(`\n\n--- Original message ---\nFrom: ${msg.from}\nDate: ${msg.date}\nSubject: ${msg.subject}\n\n${msg.snippet}`);
    setReplyContext({
      messageIdHeader: msg.id, // Gmail uses RFC Message-ID header, but message id works for thread context
      threadId: msg.threadId,
      references: msg.id,
    });
    setComposeOpen(true);
  };

  const handleSend = async () => {
    // Validate every field with Zod — rejects header injection / overlong / empty
    const toV = safeValidate(emailSchema, composeTo);
    if (!toV.ok) {
      toast({ title: "Invalid recipient", description: toV.error, variant: "destructive" });
      return;
    }
    const sV = safeValidate(subjectSchema, composeSubject);
    if (!sV.ok) {
      toast({ title: "Invalid subject", description: sV.error, variant: "destructive" });
      return;
    }
    const bV = safeValidate(messageBodySchema, composeBody);
    if (!bV.ok) {
      toast({ title: "Invalid message", description: bV.error, variant: "destructive" });
      return;
    }

    setSending(true);
    try {
      const raw = buildRawEmail({
        to: toV.data,
        subject: sV.data,
        body: bV.data,
        inReplyTo: replyContext?.messageIdHeader,
        references: replyContext?.references,
      });
      const sendArgs: any = { userId: "me", resource: { raw } };
      if (replyContext?.threadId) sendArgs.resource.threadId = replyContext.threadId;
      await window.gapi.client.gmail.users.messages.send(sendArgs);
      toast({ title: composeMode === "reply" ? "Reply sent" : "Email sent", description: `Delivered to ${toV.data}.` });
      setComposeOpen(false);
      // refresh inbox so sent thread updates
      fetchMessages();
    } catch (e: any) {
      toast({ title: "Send failed", description: e?.result?.error?.message || e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    } catch {
      return dateStr;
    }
  };

  const formatFromName = (from: string) => {
    const match = from.match(/^"?([^"<]+)"?\s*</);
    return match ? match[1].trim() : from.split("@")[0];
  };

  // Lightweight, read-only verification that creds + OAuth are valid.
  // Pings users.getProfile (cheapest authenticated Gmail call).
  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      if (!clientReady) {
        throw new Error("Client not initialized. Save credentials first.");
      }
      if (!authorized || window.gapi.client.getToken() === null) {
        throw new Error("Not authorized. Click Authorize to grant Gmail access.");
      }
      const res = await window.gapi.client.gmail.users.getProfile({ userId: "me" });
      const email = res?.result?.emailAddress;
      const total = res?.result?.messagesTotal;
      const msg = email ? `Connected as ${email} · ${total ?? 0} messages` : "Connected";
      setTestResult({ ok: true, message: msg });
      toast({ title: "Connection OK", description: msg });
    } catch (e: any) {
      const m = e?.result?.error?.message || e?.message || "Connection failed";
      setTestResult({ ok: false, message: m });
      toast({ title: "Connection failed", description: m, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }, [clientReady, authorized]);

  // Send a tiny self-addressed email to confirm the send pipeline works end-to-end.
  // Uses the authorized account's own address (looked up via users.getProfile)
  // — no user input required, no risk of sending to a wrong recipient.
  const handleSendTestEmail = useCallback(async () => {
    if (!authorized || window.gapi.client.getToken() === null) {
      toast({ title: "Not authorized", description: "Click Authorize first.", variant: "destructive" });
      return;
    }
    setSendingTest(true);
    setTestResult(null);
    try {
      const profileResp = await window.gapi.client.gmail.users.getProfile({ userId: "me" });
      const myEmail = profileResp?.result?.emailAddress;
      if (!myEmail) throw new Error("Couldn't determine your Gmail address.");

      const stamp = new Date().toLocaleString();
      const raw = buildRawEmail({
        to: myEmail,
        subject: `ConvoHub test message · ${stamp}`,
        body: [
          "This is an automated test email sent from ConvoHub.",
          "",
          `Sent at: ${stamp}`,
          "If you can read this in your inbox, the Gmail API send pipeline is working.",
        ].join("\n"),
      });
      await window.gapi.client.gmail.users.messages.send({ userId: "me", resource: { raw } });
      const okMsg = `Test email delivered to ${myEmail}.`;
      setTestResult({ ok: true, message: okMsg });
      toast({ title: "Test email sent", description: okMsg });
      // Refresh inbox so the test message shows up immediately
      fetchMessages();
    } catch (e: any) {
      const m = e?.result?.error?.message || e?.message || "Failed to send test email";
      setTestResult({ ok: false, message: m });
      toast({ title: "Test email failed", description: m, variant: "destructive" });
    } finally {
      setSendingTest(false);
    }
  }, [authorized, fetchMessages]);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="mb-6 md:mb-8 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Mail className="h-7 w-7 text-primary" />
            Gmail API
          </h1>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">View, reply to, and compose emails</p>
        </div>
        {authorized && (
          <Button onClick={openCompose} className="gap-2">
            <Pencil className="h-4 w-4" /> Compose
          </Button>
        )}
      </div>

      {/* Credentials */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            Google API Credentials
          </h3>
          {credsSaved && !editingCreds && (
            <Badge className="bg-green-500/10 text-green-600 border-green-500/20 gap-1">
              <CheckCircle2 className="h-3 w-3" /> Saved
            </Badge>
          )}
        </div>

        {credsLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : credsSaved && !editingCreds ? (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label className="text-xs text-muted-foreground">OAuth Client ID</Label>
                <div className="font-mono text-sm bg-muted/50 rounded-md px-3 py-2 mt-1 select-none">{savedClientIdMask}</div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">API Key</Label>
                <div className="font-mono text-sm bg-muted/50 rounded-md px-3 py-2 mt-1 select-none">{savedApiKeyMask}</div>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditingCreds(true)}>
              Replace credentials
            </Button>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>OAuth Client ID</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder="xxxx.apps.googleusercontent.com"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder="AIzaSy..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  maxLength={200}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <Button onClick={handleSaveCreds} disabled={!clientId.trim() || !apiKey.trim()}>
                Save credentials
              </Button>
              {credsSaved && (
                <Button variant="ghost" onClick={() => setEditingCreds(false)}>
                  Cancel
                </Button>
              )}
              {!ready && <p className="text-xs text-muted-foreground self-center">Loading Google libraries…</p>}
            </div>
          </>
        )}
      </motion.div>

      {/* Authorization */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="rounded-xl border border-border bg-card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-card-foreground">Authorization</h3>
          <Badge variant={authorized ? "default" : "outline"} className={authorized ? "bg-green-500/10 text-green-600 border-green-500/20" : ""}>
            {authorized ? "Connected" : "Not Connected"}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {!authorized ? (
            <>
              <Button onClick={handleAuth} className="gap-2" disabled={!clientReady}>
                <LogIn className="h-4 w-4" /> Authorize
              </Button>
              <Button
                variant="outline"
                onClick={handleTestConnection}
                disabled={!clientReady || testing}
                className="gap-2"
              >
                <Wifi className={`h-4 w-4 ${testing ? "animate-pulse" : ""}`} />
                {testing ? "Testing…" : "Test Connection"}
              </Button>
              {!credsSaved && (
                <p className="text-xs text-muted-foreground self-center">Save credentials above to enable.</p>
              )}
              {credsSaved && !clientReady && ready && (
                <p className="text-xs text-muted-foreground self-center">Initializing Gmail client…</p>
              )}
              {credsSaved && !ready && (
                <p className="text-xs text-muted-foreground self-center">Loading Google libraries…</p>
              )}
            </>
          ) : (
            <>
              <Button variant="outline" onClick={fetchMessages} className="gap-2" disabled={loadingMessages}>
                <RefreshCw className={`h-4 w-4 ${loadingMessages ? "animate-spin" : ""}`} /> Refresh
              </Button>
              <Button
                variant="outline"
                onClick={handleTestConnection}
                disabled={testing}
                className="gap-2"
              >
                <Wifi className={`h-4 w-4 ${testing ? "animate-pulse" : ""}`} />
                {testing ? "Testing…" : "Test Connection"}
              </Button>
              <Button variant="ghost" onClick={handleSignout} className="gap-2 text-destructive">
                <LogOut className="h-4 w-4" /> Sign Out
              </Button>
              {slackWebhook && (
                <Badge variant="outline" className="self-center text-xs gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" /> Slack notifications enabled
                </Badge>
              )}
            </>
          )}
        </div>
        {testResult && (
          <div
            className={`mt-3 rounded-md border px-3 py-2 text-xs flex items-center gap-2 ${
              testResult.ok
                ? "border-success/30 bg-success/5 text-success"
                : "border-destructive/30 bg-destructive/5 text-destructive"
            }`}
          >
            {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            <span className="break-all">{testResult.message}</span>
          </div>
        )}
      </motion.div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 mb-6 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Tabs */}
      {authorized && (
        <>
          <div className="flex gap-1 mb-6 border-b border-border">
            <button
              onClick={() => {
                setActiveTab("messages");
                setSelectedMessage(null);
              }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "messages" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Inbox className="h-4 w-4 inline mr-2" />
              Inbox ({messages.length})
            </button>
            <button
              onClick={() => {
                setActiveTab("labels");
                setSelectedMessage(null);
              }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "labels" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Tag className="h-4 w-4 inline mr-2" />
              Labels ({labels.length})
            </button>
          </div>

          <AnimatePresence mode="wait">
            {activeTab === "labels" && (
              <motion.div key="labels" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-xl border border-border bg-card p-6">
                {labels.length === 0 && !loading ? (
                  <p className="text-sm text-muted-foreground">No labels found.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {labels.map((label) => (
                      <Badge key={label.id} variant={label.type === "system" ? "default" : "outline"} className="text-xs">
                        {label.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === "messages" && !selectedMessage && (
              <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-xl border border-border bg-card overflow-hidden">
                {loadingMessages ? (
                  <div className="p-4 space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex gap-3 items-start">
                        <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-1/3" />
                          <Skeleton className="h-3 w-full" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground">
                    <Inbox className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p>No messages found in your inbox.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {messages.map((msg) => (
                      <button
                        key={msg.id}
                        onClick={() => setSelectedMessage(msg)}
                        className="w-full text-left px-5 py-3.5 hover:bg-muted/40 transition-colors flex gap-3 items-start"
                      >
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary mt-0.5">
                          {formatFromName(msg.from).charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-foreground truncate">{formatFromName(msg.from)}</span>
                            <span className="text-xs text-muted-foreground flex-shrink-0 flex items-center gap-1">
                              {msg.hasAttachments && <Paperclip className="h-3 w-3" />}
                              <Clock className="h-3 w-3" />
                              {formatDate(msg.date)}
                            </span>
                          </div>
                          <p className="text-sm text-foreground truncate">{msg.subject}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{msg.snippet}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === "messages" && selectedMessage && (
              <motion.div key="detail" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="rounded-xl border border-border bg-card">
                <div className="border-b border-border px-6 py-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => setSelectedMessage(null)}>
                      <ArrowLeft className="h-4 w-4" /> Back to Inbox
                    </Button>
                    <Button onClick={() => openReply(selectedMessage)} size="sm" className="gap-1.5">
                      <Reply className="h-4 w-4" /> Reply
                    </Button>
                  </div>
                  <h2 className="text-lg font-semibold text-foreground">{selectedMessage.subject}</h2>
                  <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{selectedMessage.from}</span>
                    <span>•</span>
                    <span>{new Date(selectedMessage.date).toLocaleString()}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {selectedMessage.labelIds.map((l) => (
                      <Badge key={l} variant="outline" className="text-[10px]">
                        {l}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="p-6">
                  {selectedMessage.body.includes("<") ? (
                    <div
                      className="prose prose-sm max-w-none dark:prose-invert"
                      // Sanitize HTML before rendering — strips scripts, on* handlers, javascript: URLs.
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(selectedMessage.body, {
                          USE_PROFILES: { html: true },
                          FORBID_TAGS: ["style", "script", "iframe", "form", "input", "object", "embed"],
                          FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "style"],
                        }),
                      }}
                    />
                  ) : (
                    <pre className="text-sm text-foreground whitespace-pre-wrap font-sans">{selectedMessage.body || selectedMessage.snippet}</pre>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Compose / Reply Dialog */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {composeMode === "reply" ? <Reply className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
              {composeMode === "reply" ? "Reply" : "New Email"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="compose-to">To</Label>
              <Input
                id="compose-to"
                type="email"
                placeholder="recipient@example.com"
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
                maxLength={254}
                disabled={composeMode === "reply"}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="compose-subject">Subject</Label>
              <Input
                id="compose-subject"
                placeholder="Subject"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                maxLength={200}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="compose-body">Message</Label>
              <Textarea
                id="compose-body"
                placeholder="Write your message…"
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                rows={10}
                maxLength={10_000}
                className="resize-none"
              />
              <p className="text-[10px] text-muted-foreground text-right">{composeBody.length}/10000</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setComposeOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={handleSend} disabled={sending} className="gap-2">
              <Send className="h-4 w-4" />
              {sending ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GmailAPI;
