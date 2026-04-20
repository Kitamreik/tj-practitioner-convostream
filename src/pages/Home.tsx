import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  PhoneCall,
  Mail,
  MessageSquare,
  Inbox,
  Send,
  Activity,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { collection, onSnapshot, orderBy, query, limit, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { loadAllIntegrations } from "@/lib/integrationsStore";
import { pingWebmasterSlackAlert } from "@/lib/notifyWebmaster";
import {
  emailSchema,
  subjectSchema,
  messageBodySchema,
  safeValidate,
} from "@/lib/validation";

/**
 * Support call-center landing page.
 *
 * Shown at `/` ONLY for the Support account (support@convohub.dev). Every
 * other role still sees the full Conversations inbox at `/`.
 *
 * The page provides:
 *   - Live KPI tiles for the conversations queue (open / waiting / resolved).
 *   - A quick-compose Gmail card that loads the user's saved Gmail-API
 *     credentials and sends through the same client used on /gmail. If the
 *     OAuth token isn't already in this tab a "Connect Gmail" CTA points to
 *     /gmail to complete consent (one-time).
 *   - A quick-Slack card that fires the existing pingWebmasterSlackAlert
 *     callable so Support can notify the on-call team in one tap.
 *   - A live "Recent activity" list with click-through to the full thread.
 */

const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest";
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

function encodeBase64Url(str: string): string {
  const utf8 = new TextEncoder().encode(str);
  let binary = "";
  utf8.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildRawEmail(opts: { to: string; subject: string; body: string }): string {
  const safeHeader = (s: string) => String(s).replace(/[\r\n]+/g, " ");
  const lines = [
    `To: ${safeHeader(opts.to)}`,
    `Subject: ${safeHeader(opts.subject)}`,
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0",
    "",
    opts.body,
  ];
  return encodeBase64Url(lines.join("\r\n"));
}

interface QueueCounts {
  active: number;
  waiting: number;
  resolved: number;
  total: number;
}

interface RecentConvo {
  id: string;
  customerName: string;
  status: string;
  channel: string;
  snippet: string;
  timestampMs: number;
}

const Home: React.FC = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  // ---- Live queue counters ------------------------------------------------
  const [counts, setCounts] = useState<QueueCounts>({ active: 0, waiting: 0, resolved: 0, total: 0 });
  useEffect(() => {
    // Single global listener — the conversations collection is small enough
    // that a full-collection snapshot is cheaper than three separate where()
    // queries (and we need recent activity from the same data anyway).
    const unsub = onSnapshot(
      query(collection(db, "conversations"), orderBy("timestamp", "desc"), limit(50)),
      (snap) => {
        let active = 0;
        let waiting = 0;
        let resolved = 0;
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          if (data.archived) return;
          if (data.status === "active") active++;
          else if (data.status === "waiting") waiting++;
          else if (data.status === "resolved") resolved++;
        });
        setCounts({ active, waiting, resolved, total: active + waiting + resolved });
      },
      () => setCounts({ active: 0, waiting: 0, resolved: 0, total: 0 })
    );
    return unsub;
  }, []);

  // ---- Recent activity (top 10) ------------------------------------------
  const [recent, setRecent] = useState<RecentConvo[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(
      query(
        collection(db, "conversations"),
        where("archived", "!=", true),
        orderBy("archived"),
        orderBy("timestamp", "desc"),
        limit(10)
      ),
      (snap) => {
        const rows: RecentConvo[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            customerName: data.customerName ?? "Unknown",
            status: data.status ?? "active",
            channel: data.channel ?? "—",
            snippet: data.lastMessage ?? data.snippet ?? "",
            timestampMs: data.timestamp?.toMillis?.() ?? 0,
          };
        });
        setRecent(rows);
      },
      () => setRecent([])
    );
    return unsub;
  }, []);

  // ---- Gmail quick-compose ------------------------------------------------
  const [gmailReady, setGmailReady] = useState(false);
  const [gmailAuthorized, setGmailAuthorized] = useState(false);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const tokenClientRef = useRef<any>(null);

  // Init Gmail client lazily once we have the user's saved creds.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await loadAllIntegrations(user.uid);
        const cfg = all["gmail-api"];
        const clientId = cfg?.fields?.clientId;
        const apiKey = cfg?.fields?.apiKey;
        if (!clientId || !apiKey) {
          if (!cancelled) setGmailError("not-configured");
          return;
        }
        await Promise.all([
          loadScript("https://apis.google.com/js/api.js"),
          loadScript("https://accounts.google.com/gsi/client"),
        ]);
        if (cancelled) return;
        await new Promise<void>((res) => window.gapi.load("client", () => res()));
        await window.gapi.client.init({ apiKey, discoveryDocs: [DISCOVERY_DOC] });
        if (cancelled) return;
        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPES,
          callback: () => {
            /* per-request callback set in compose flow */
          },
        });
        setGmailReady(true);
        // If gapi already has a token cached in this tab, mark authorized.
        if (window.gapi.client.getToken?.()) setGmailAuthorized(true);
      } catch (e: any) {
        if (!cancelled) setGmailError(e?.message || "Failed to initialize Gmail client");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const ensureGmailToken = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      const tc = tokenClientRef.current;
      if (!tc) {
        resolve(false);
        return;
      }
      tc.callback = (resp: any) => {
        if (resp?.error) {
          resolve(false);
          return;
        }
        setGmailAuthorized(true);
        resolve(true);
      };
      try {
        if (window.gapi.client.getToken() === null) {
          tc.requestAccessToken({ prompt: "consent" });
        } else {
          tc.requestAccessToken({ prompt: "" });
        }
      } catch {
        resolve(false);
      }
    });
  }, []);

  // Compose dialog state
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);

  const handleOpenCompose = async () => {
    if (gmailError === "not-configured") {
      toast({
        title: "Gmail not configured",
        description: "Save Gmail API credentials on /gmail first.",
        variant: "destructive",
      });
      navigate("/gmail");
      return;
    }
    if (!gmailReady) {
      toast({ title: "Gmail still loading", description: "Try again in a moment." });
      return;
    }
    if (!gmailAuthorized) {
      const ok = await ensureGmailToken();
      if (!ok) {
        toast({
          title: "Gmail authorization needed",
          description: "Open /gmail to grant access in a top-level tab, then return here.",
          variant: "destructive",
        });
        return;
      }
    }
    setComposeOpen(true);
  };

  const handleSendCompose = async () => {
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
      const raw = buildRawEmail({ to: toV.data, subject: sV.data, body: bV.data });
      await window.gapi.client.gmail.users.messages.send({ userId: "me", resource: { raw } });
      toast({ title: "Email sent", description: `Delivered to ${toV.data}.` });
      setComposeOpen(false);
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
    } catch (e: any) {
      const msg = e?.result?.error?.message || e?.message || "Send failed";
      toast({ title: "Send failed", description: msg, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  // ---- Slack quick-ping ---------------------------------------------------
  const [slackSending, setSlackSending] = useState(false);
  const [slackMessage, setSlackMessage] = useState("");
  const handleSlackPing = async () => {
    setSlackSending(true);
    try {
      const res = await pingWebmasterSlackAlert({
        agentName: profile?.displayName || "Support",
        route: "/",
        message: slackMessage.trim() || undefined,
      });
      if (!res.ok) {
        toast({
          title: res.rateLimited ? "Cooldown active" : "Slack ping failed",
          description: res.error || "Try again in a moment.",
          variant: "destructive",
        });
        return;
      }
      const next = new Date(res.nextAllowedAt ?? Date.now() + 10 * 60 * 1000);
      toast({
        title: "Slack alert sent",
        description: `${slackMessage.trim() ? "Custom message delivered. " : ""}Next ping allowed after ${next.toLocaleTimeString()}.`,
      });
      setSlackMessage("");
    } catch (e: any) {
      toast({
        title: "Slack ping failed",
        description: e?.message || "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSlackSending(false);
    }
  };

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-6 md:p-8"
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
              <PhoneCall className="h-3.5 w-3.5" /> Support call center
            </p>
            <h1
              className="text-2xl md:text-3xl font-bold text-foreground"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              {greeting}, {profile?.displayName || "Support"}.
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {counts.total === 0
                ? "Queue is empty — nice work."
                : `${counts.total} live conversation${counts.total === 1 ? "" : "s"} on the board.`}
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate("/conversations")} className="gap-1.5">
            <Inbox className="h-4 w-4" /> Open full inbox
          </Button>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-3 gap-3 md:gap-4 mt-6">
          <KpiTile label="Active" value={counts.active} tone="primary" />
          <KpiTile label="Waiting" value={counts.waiting} tone="warning" />
          <KpiTile label="Resolved" value={counts.resolved} tone="success" />
        </div>
      </motion.div>

      {/* Quick action cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Gmail */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="rounded-2xl border border-border bg-card p-6"
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" /> Send an email
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Compose and send through your Gmail account in one click.
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                gmailError === "not-configured"
                  ? "text-destructive border-destructive/30"
                  : gmailAuthorized
                  ? "text-success border-success/30"
                  : gmailReady
                  ? "text-muted-foreground"
                  : "text-muted-foreground"
              }
            >
              {gmailError === "not-configured"
                ? "Not configured"
                : gmailAuthorized
                ? "Connected"
                : gmailReady
                ? "Ready to authorize"
                : "Loading…"}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleOpenCompose} className="gap-1.5">
              <Send className="h-4 w-4" /> Compose email
            </Button>
            <Button variant="ghost" onClick={() => navigate("/gmail")} className="gap-1.5">
              <ExternalLink className="h-4 w-4" /> Open Gmail page
            </Button>
          </div>
        </motion.div>

        {/* Slack */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl border border-border bg-card p-6"
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" /> Notify Slack
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Ping the team Slack bot for an urgent escalation. Rate-limited to one
                alert every ten minutes.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Textarea
              value={slackMessage}
              onChange={(e) => setSlackMessage(e.target.value.slice(0, 800))}
              placeholder="Optional message body — leave blank to send the default review request…"
              rows={3}
              className="text-sm resize-none"
              disabled={slackSending}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{slackMessage.length}/800</span>
              <Button onClick={handleSlackPing} disabled={slackSending} className="gap-1.5">
                {slackSending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" /> Ping Slack
                  </>
                )}
              </Button>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Recent activity */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="rounded-2xl border border-border bg-card overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" /> Recent activity
          </h3>
          <Button variant="ghost" size="sm" onClick={() => navigate("/conversations")}>
            View all
          </Button>
        </div>
        {recent.length === 0 ? (
          <div className="px-6 py-12 text-center text-muted-foreground text-sm">
            <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
            No recent conversations.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => navigate(`/conversations/${c.id}`)}
                  className="w-full text-left px-6 py-3.5 hover:bg-muted/40 transition-colors flex gap-3 items-start"
                >
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary mt-0.5">
                    {c.customerName.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {c.customerName}
                      </span>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {c.timestampMs ? new Date(c.timestampMs).toLocaleTimeString() : "—"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {c.snippet || `${c.channel} · ${c.status}`}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="ml-2 text-[10px] capitalize self-center flex-shrink-0"
                  >
                    {c.status}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </motion.div>

      {/* Compose dialog */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" /> New email
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="home-compose-to">To</Label>
              <Input
                id="home-compose-to"
                type="email"
                placeholder="recipient@example.com"
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
                maxLength={254}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="home-compose-subject">Subject</Label>
              <Input
                id="home-compose-subject"
                placeholder="Subject"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                maxLength={200}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="home-compose-body">Message</Label>
              <Textarea
                id="home-compose-body"
                placeholder="Write your message…"
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                rows={8}
                maxLength={10000}
                className="resize-none"
              />
              <p className="text-[10px] text-muted-foreground text-right">
                {composeBody.length}/10000
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setComposeOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={handleSendCompose} disabled={sending} className="gap-1.5">
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" /> Send
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

interface KpiTileProps {
  label: string;
  value: number;
  tone: "primary" | "warning" | "success";
}

const KpiTile: React.FC<KpiTileProps> = ({ label, value, tone }) => {
  const toneClass =
    tone === "primary"
      ? "from-primary/15 to-primary/5 border-primary/20 text-primary"
      : tone === "warning"
      ? "from-warning/15 to-warning/5 border-warning/20 text-warning"
      : "from-success/15 to-success/5 border-success/20 text-success";
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${toneClass} p-4`}>
      <p className="text-xs uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-3xl font-bold mt-1 text-foreground">{value}</p>
    </div>
  );
};

export default Home;
