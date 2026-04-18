import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { MessageSquare, Phone, Mail, Hash, Check, Settings, X, Lock, Webhook, Copy, Send, Activity, Loader2, AlertCircle, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { collection, addDoc, serverTimestamp, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";
import {
  loadAllIntegrations,
  saveIntegration,
  disconnectIntegration,
  type IntegrationConfig,
} from "@/lib/integrationsStore";
import {
  emailSchema,
  phoneSchema,
  googleClientIdSchema,
  oauthSecretSchema,
  httpsUrlSchema,
  slackChannelSchema,
  slackBotTokenSchema,
  maskSecret,
  safeValidate,
  singleLine,
} from "@/lib/validation";
import type { z } from "zod";

type FieldType = "text" | "password" | "email" | "url" | "tel";

interface ConfigField {
  key: string;
  label: string;
  placeholder: string;
  type?: FieldType;
  secret?: boolean; // mask after save
  schema: z.ZodType<string, any, any>;
  optional?: boolean;
}

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  provider: string;
  configFields: ConfigField[];
  postSaveNote?: string;
}

const integrations: Integration[] = [
  {
    id: "google-voice",
    name: "Google Voice",
    description: "Receive real-time call and SMS events into ConvoHub via webhook.",
    icon: <Phone className="h-6 w-6" />,
    provider: "Google Workspace",
    configFields: [
      { key: "googleAccount", label: "Google Account Email", placeholder: "you@yourdomain.com", type: "email", schema: emailSchema },
      { key: "voiceNumber", label: "Google Voice Number", placeholder: "+15551234567", type: "tel", schema: phoneSchema },
      { key: "webhookSecret", label: "Webhook shared secret", placeholder: "Random 32+ char string", type: "password", secret: true, schema: oauthSecretSchema },
    ],
    postSaveNote: "Use the Webhook Contract panel below to forward call/SMS events into Firestore.",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Connect agent inboxes for unified email conversations and Slack notifications.",
    icon: <Mail className="h-6 w-6" />,
    provider: "Google Workspace",
    configFields: [
      // SECURITY: NEVER ask for the OAuth Client Secret in the browser. The Gmail
      // integration uses Google Identity Services (GIS) implicit flow, which only
      // needs the public Client ID + browser-restricted API key.
      { key: "clientId", label: "OAuth Client ID", placeholder: "xxxx.apps.googleusercontent.com", type: "password", secret: true, schema: googleClientIdSchema },
      { key: "redirectUri", label: "Authorized JavaScript Origin", placeholder: "https://your-app.com", type: "url", schema: httpsUrlSchema },
      { key: "syncEmail", label: "Gmail Address to Sync", placeholder: "support@yourbrand.com", type: "email", schema: emailSchema },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Get notified in Slack when new emails arrive in connected Gmail inboxes.",
    icon: <Hash className="h-6 w-6" />,
    provider: "Slack API",
    configFields: [
      { key: "webhookUrl", label: "Slack Incoming Webhook URL", placeholder: "https://hooks.slack.com/services/T.../B.../xxxx", type: "url", secret: true, schema: httpsUrlSchema },
      { key: "defaultChannel", label: "Default Channel", placeholder: "support", schema: slackChannelSchema },
      { key: "botToken", label: "Bot Token (optional)", placeholder: "xoxb-xxxx", type: "password", secret: true, optional: true, schema: slackBotTokenSchema },
    ],
    postSaveNote: "Slack will receive a notification each time Gmail finds a new inbound message.",
  },
];

const Integrations: React.FC = () => {
  const { toast } = useToast();
  const { user, profile } = useAuth();
  const [configOpen, setConfigOpen] = useState<string | null>(null);
  const [savedConfigs, setSavedConfigs] = useState<Record<string, IntegrationConfig>>({});
  const [draftConfig, setDraftConfig] = useState<Record<string, string>>({});
  const [editingFields, setEditingFields] = useState<Set<string>>(new Set());
  const [loadingConfigs, setLoadingConfigs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [simulating, setSimulating] = useState<"call" | "sms" | null>(null);

  // Health-check panel state. Live ping is webmaster-only (matches callable
  // permission); the "Trigger scheduled run now" QA button is also available
  // to admins so they can validate the unattended path without waiting 5 days.
  type HealthResult = { ok: boolean; message: string; latencyMs: number };
  const [healthRunning, setHealthRunning] = useState(false);
  const [healthResults, setHealthResults] = useState<Record<string, HealthResult> | null>(null);
  const [healthCheckedAt, setHealthCheckedAt] = useState<number | null>(null);
  const [scheduledRunning, setScheduledRunning] = useState(false);
  const isWebmaster = profile?.role === "webmaster";
  const canTriggerScheduled = isWebmaster || profile?.role === "admin";

  // Live last-5 health-check runs (rules: webmaster-only). Used to show a
  // small trend table below the panel without hitting Firestore manually.
  type HistoryRow = {
    id: string;
    checkedAtMs: number;
    source: "manual" | "scheduled" | string;
    failingProviders: string[];
    anyFailing: boolean;
  };
  const [healthHistory, setHealthHistory] = useState<HistoryRow[]>([]);
  useEffect(() => {
    if (!isWebmaster) {
      setHealthHistory([]);
      return;
    }
    const q = query(
      collection(db, "integrationsHealthHistory"),
      orderBy("checkedAtMs", "desc"),
      limit(5)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setHealthHistory(
          snap.docs.map((d) => {
            const data = d.data() as Partial<HistoryRow>;
            return {
              id: d.id,
              checkedAtMs: typeof data.checkedAtMs === "number" ? data.checkedAtMs : 0,
              source: (data.source as string) ?? "manual",
              failingProviders: Array.isArray(data.failingProviders) ? data.failingProviders : [],
              anyFailing: !!data.anyFailing,
            };
          })
        );
      },
      (err) => console.warn("integrationsHealthHistory listener:", err)
    );
    return unsub;
  }, [isWebmaster]);

  const runHealthCheck = async () => {
    setHealthRunning(true);
    try {
      // Pull the cached Gmail OAuth token (set by /gmail-api after the user
      // signs in) so the server can validate it. If it's missing the server
      // returns a non-fatal "open Gmail API once" hint per provider.
      const gmailAccessToken =
        sessionStorage.getItem("gmail.accessToken") ||
        localStorage.getItem("gmail.accessToken") ||
        null;
      const fn = httpsCallable<
        { gmailAccessToken: string | null },
        { ok: boolean; results: Record<string, HealthResult>; checkedAt: number }
      >(functions, "integrationsHealthCheck");
      const res = await fn({ gmailAccessToken });
      setHealthResults(res.data.results);
      setHealthCheckedAt(res.data.checkedAt);
      const failures = Object.values(res.data.results).filter((r) => !r.ok).length;
      toast({
        title: failures === 0 ? "All integrations healthy" : `${failures} issue${failures === 1 ? "" : "s"} found`,
        description: failures === 0 ? "Slack, Twilio, Gmail and Google Voice are live." : "Click each card for details.",
        variant: failures === 0 ? "default" : "destructive",
      });
    } catch (e: any) {
      toast({
        title: "Health check failed",
        description: e?.message || "Could not reach the health-check endpoint.",
        variant: "destructive",
      });
    } finally {
      setHealthRunning(false);
    }
  };

  // QA-only: invokes the same body the every-5-days scheduler runs, so we can
  // validate the unattended path (no Gmail token, source: "scheduled",
  // persisted summary doc) without waiting for the timer.
  const triggerScheduledNow = async () => {
    setScheduledRunning(true);
    try {
      const fn = httpsCallable<
        Record<string, never>,
        { ok: boolean; results: Record<string, HealthResult>; failing: string[]; checkedAt: number }
      >(functions, "triggerScheduledHealthCheckNow");
      const res = await fn({});
      // Surface results in the same panel so QA sees what the scheduler saw.
      setHealthResults(res.data.results);
      setHealthCheckedAt(res.data.checkedAt);
      const failing = res.data.failing.length;
      toast({
        title: failing === 0 ? "Scheduled run: all healthy" : `Scheduled run: ${failing} issue${failing === 1 ? "" : "s"}`,
        description:
          failing === 0
            ? "Persisted to system/integrationsHealth as source:'scheduled'."
            : `Failing: ${res.data.failing.join(", ")}`,
        variant: failing === 0 ? "default" : "destructive",
      });
    } catch (e: any) {
      toast({
        title: "Could not trigger scheduled run",
        description: e?.message || "Function call failed.",
        variant: "destructive",
      });
    } finally {
      setScheduledRunning(false);
    }
  };

  const activeIntg = integrations.find((i) => i.id === configOpen);

  // Load saved configs
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const all = await loadAllIntegrations(user.uid);
      if (!cancelled) {
        setSavedConfigs(all);
        setLoadingConfigs(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // When opening config dialog, prepare draft from saved values (secrets stay masked unless user edits)
  useEffect(() => {
    if (!configOpen || !activeIntg) {
      setDraftConfig({});
      setEditingFields(new Set());
      return;
    }
    const saved = savedConfigs[configOpen]?.fields || {};
    const draft: Record<string, string> = {};
    activeIntg.configFields.forEach((f) => {
      const val = saved[f.key];
      draft[f.key] = val ? (f.secret ? maskSecret(val) : val) : "";
    });
    setDraftConfig(draft);
    setEditingFields(new Set());
  }, [configOpen, activeIntg, savedConfigs]);

  const isConnected = (id: string) => !!savedConfigs[id]?.connected;

  const handleFieldChange = (key: string, value: string, secret?: boolean) => {
    setDraftConfig((prev) => ({ ...prev, [key]: value }));
    if (secret) {
      // mark as edited so we treat it as new plaintext value (not the mask)
      setEditingFields((prev) => new Set(prev).add(key));
    }
  };

  const handleSave = async () => {
    if (!user || !configOpen || !activeIntg) return;
    setSaving(true);
    try {
      const saved = savedConfigs[configOpen]?.fields || {};
      const cleaned: Record<string, string> = {};

      for (const field of activeIntg.configFields) {
        const draftVal = draftConfig[field.key]?.trim() || "";
        const isMasked = field.secret && !editingFields.has(field.key) && saved[field.key];

        if (isMasked) {
          // user didn't touch this secret — keep the existing real value
          cleaned[field.key] = saved[field.key];
          continue;
        }

        if (!draftVal) {
          if (field.optional) continue;
          toast({ title: `${field.label} required`, variant: "destructive" });
          setSaving(false);
          return;
        }

        const v = safeValidate(field.schema, draftVal);
        if (!v.ok) {
          toast({ title: `Invalid ${field.label}`, description: v.error, variant: "destructive" });
          setSaving(false);
          return;
        }
        cleaned[field.key] = v.data;
      }

      await saveIntegration(user.uid, configOpen, cleaned, true);
      setSavedConfigs((prev) => ({
        ...prev,
        [configOpen]: { fields: cleaned, connected: true },
      }));
      toast({ title: `${activeIntg.name} saved`, description: activeIntg.postSaveNote || "Integration credentials stored securely." });
      setConfigOpen(null);
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    if (!user) return;
    try {
      await disconnectIntegration(user.uid, id);
      setSavedConfigs((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      toast({ title: "Integration disconnected" });
    } catch (e: any) {
      toast({ title: "Disconnect failed", description: e?.message, variant: "destructive" });
    }
  };

  // ----- Real Cloud Function webhook URLs -----
  // These point at the deployed firebase-functions endpoints. Once you run
  // `firebase deploy --only functions:slackEvents,functions:twilioInbound`,
  // copy these URLs into Slack's Event Subscriptions request_url and
  // Twilio's Voice/SMS webhook config in the Twilio Console.
  const fnBase = "https://us-central1-convo-hub-71514.cloudfunctions.net";
  const twilioWebhookUrl = `${fnBase}/twilioInbound`;
  const slackWebhookUrl = `${fnBase}/slackEvents`;
  const webhookUrl = twilioWebhookUrl;

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast({ title: "Webhook URL copied" });
  };

  const simulateVoiceEvent = async (type: "call" | "sms") => {
    setSimulating(type);
    try {
      const isCall = type === "call";
      const sampleContacts = ["+1 555-0142", "+1 555-0118", "+1 555-0177"];
      const contact = sampleContacts[Math.floor(Math.random() * sampleContacts.length)];
      const eventType = Math.random() > 0.5 ? `${isCall ? "call" : "sms"}_inbound` : `${isCall ? "call" : "sms"}_outbound`;
      const sampleSnippets = [
        "Hi, I have a question about my recent order.",
        "Can someone help me reset my password?",
        "Thanks for the quick reply!",
        "I'd like to upgrade my plan.",
      ];
      await addDoc(collection(db, "googleVoiceActivity"), {
        type: eventType,
        contact: singleLine(contact),
        durationSec: isCall ? Math.floor(Math.random() * 240) + 30 : null,
        preview: isCall ? null : singleLine(sampleSnippets[Math.floor(Math.random() * sampleSnippets.length)]),
        timestamp: serverTimestamp(),
        source: "simulator",
      });
      toast({ title: "Test event published", description: `Simulated ${eventType.replace("_", " ")} from ${contact}. Check Analytics.` });
    } catch (e: any) {
      toast({ title: "Failed to publish", description: e?.message, variant: "destructive" });
    } finally {
      setSimulating(null);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl font-bold text-foreground">Integrations</h1>
        <p className="text-muted-foreground mt-1 text-sm md:text-base">Connect your communication channels — secrets are encrypted and masked after save.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 mb-8">
        {integrations.map((intg, i) => {
          const connected = isConnected(intg.id);
          return (
            <motion.div
              key={intg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="rounded-xl border border-border bg-card p-6 flex flex-col"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">{intg.icon}</div>
                <div className="flex items-center gap-2">
                  {connected && (
                    <Badge className="bg-success/10 text-success border-success/20 text-xs gap-1">
                      <Check className="h-3 w-3" />
                      Connected
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-xs">{intg.provider}</Badge>
                </div>
              </div>
              <h3 className="text-lg font-semibold text-card-foreground mb-1">{intg.name}</h3>
              <p className="text-sm text-muted-foreground mb-6 flex-1">{intg.description}</p>
              <div className="flex gap-2">
                <Button variant={connected ? "outline" : "default"} className="flex-1 gap-2" onClick={() => setConfigOpen(intg.id)} disabled={loadingConfigs}>
                  <Settings className="h-3.5 w-3.5" />
                  {connected ? "Settings" : "Configure"}
                </Button>
                {connected && (
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDisconnect(intg.id)} aria-label="Disconnect">
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Health Check panel — webmaster runs the live ping; webmaster+admin can
          also fire the scheduled-job code path on demand for QA. */}
      {canTriggerScheduled && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="rounded-xl border border-border bg-card p-6 mb-8"
        >
          <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                Health Check
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                  {isWebmaster ? "Webmaster" : "Admin"}
                </Badge>
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Pings Slack <code className="bg-muted px-1 rounded">auth.test</code>, Twilio account info,
                Gmail token validity, and Google Voice activity to confirm each credential is live.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 flex-shrink-0">
              {isWebmaster && (
                <Button onClick={runHealthCheck} disabled={healthRunning} className="gap-2">
                  {healthRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
                  {healthRunning ? "Checking…" : healthResults ? "Re-run check" : "Run check"}
                </Button>
              )}
              <Button
                onClick={triggerScheduledNow}
                disabled={scheduledRunning}
                variant="outline"
                className="gap-2"
                title="Runs the same code path as the every-5-days scheduled job and persists the result with source:'scheduled'."
              >
                {scheduledRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
                {scheduledRunning ? "Triggering…" : "Trigger scheduled run now"}
              </Button>
            </div>
          </div>

          {healthResults ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { id: "slack", label: "Slack", icon: <Hash className="h-4 w-4" /> },
                { id: "twilio", label: "Twilio (SMS / Voice)", icon: <MessageSquare className="h-4 w-4" /> },
                { id: "gmail", label: "Gmail", icon: <Mail className="h-4 w-4" /> },
                { id: "google-voice", label: "Google Voice", icon: <Phone className="h-4 w-4" /> },
              ].map((p) => {
                const r = healthResults[p.id];
                const ok = r?.ok;
                return (
                  <div
                    key={p.id}
                    className={`rounded-lg border p-3 flex items-start gap-3 ${
                      r ? (ok ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5") : "border-border bg-muted/30"
                    }`}
                  >
                    <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ${ok ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                      {p.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-card-foreground">{p.label}</span>
                        {r ? (
                          <Badge
                            className={`text-[10px] gap-1 ${
                              ok ? "bg-success/10 text-success border-success/20" : "bg-destructive/10 text-destructive border-destructive/20"
                            }`}
                          >
                            {ok ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                            {ok ? "Live" : "Issue"}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Not checked</Badge>
                        )}
                        {r?.latencyMs ? (
                          <span className="text-[10px] text-muted-foreground">{r.latencyMs}ms</span>
                        ) : null}
                      </div>
                      <p className={`mt-1 text-xs break-words ${ok ? "text-muted-foreground" : "text-destructive"}`}>
                        {r?.message ?? "Run the check to test this integration."}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              Click <strong>Run check</strong> to ping every configured integration.
            </p>
          )}

          {healthCheckedAt && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Last checked {new Date(healthCheckedAt).toLocaleTimeString()}
            </p>
          )}
        </motion.div>
      )}

      {/* Real ingestion webhooks */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="rounded-xl border border-border bg-card p-6 mb-8">

        <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2 mb-2">
          <Webhook className="h-5 w-5 text-primary" />
          Inbound Webhooks (Live)
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Once you deploy the Cloud Functions (<code className="bg-muted px-1 rounded">firebase deploy --only functions</code>), point each provider at the URL below. Inbound messages land directly in <strong>Conversations</strong>, dedup'd by sender.
        </p>

        <div className="space-y-3 mb-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Twilio (SMS + Voice)</p>
            <div className="rounded-lg border border-border bg-muted/40 p-3 flex items-center justify-between gap-2">
              <code className="text-xs font-mono text-foreground break-all">{twilioWebhookUrl}</code>
              <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(twilioWebhookUrl); toast({ title: "Twilio URL copied" }); }} aria-label="Copy URL">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Twilio Console → Phone Numbers → your number → Messaging "A message comes in" + Voice "A call comes in" → Webhook (POST). Requires <code className="bg-muted px-1 rounded">TWILIO_AUTH_TOKEN</code> env var on the function. Port your Google Voice number to Twilio to use it as a real number.
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Slack (Custom App)</p>
            <div className="rounded-lg border border-border bg-muted/40 p-3 flex items-center justify-between gap-2">
              <code className="text-xs font-mono text-foreground break-all">{slackWebhookUrl}</code>
              <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(slackWebhookUrl); toast({ title: "Slack URL copied" }); }} aria-label="Copy URL">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Create a custom Slack app at api.slack.com/apps using the manifest at <code className="bg-muted px-1 rounded">docs/slack-app-manifest.json</code>. Replace <code className="bg-muted px-1 rounded">REQUEST_URL_PLACEHOLDER</code> with the URL above. Requires <code className="bg-muted px-1 rounded">SLACK_SIGNING_SECRET</code> + <code className="bg-muted px-1 rounded">SLACK_BOT_TOKEN</code> env vars.
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Gmail</p>
            <p className="text-[11px] text-muted-foreground">
              Gmail uses your existing OAuth session — open <a href="/gmail-api" className="underline">Gmail API</a>, authorize, then click <strong>Push to ConvoHub</strong> on any inbound message to import it as a conversation.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => simulateVoiceEvent("call")} disabled={simulating !== null} className="gap-2">
            <Phone className="h-3.5 w-3.5" />
            {simulating === "call" ? "Publishing…" : "Simulate inbound call"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => simulateVoiceEvent("sms")} disabled={simulating !== null} className="gap-2">
            <MessageSquare className="h-3.5 w-3.5" />
            {simulating === "sms" ? "Publishing…" : "Simulate inbound SMS"}
          </Button>
          <p className="text-xs text-muted-foreground self-center">Mock events appear in Analytics for UI testing.</p>
        </div>
      </motion.div>


      {/* Config Dialog */}
      <Dialog open={!!configOpen} onOpenChange={(o) => !o && setConfigOpen(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              Configure {activeIntg?.name}
            </DialogTitle>
          </DialogHeader>
          {activeIntg && (
            <div className="space-y-4 mt-2">
              <p className="text-xs text-muted-foreground">
                {activeIntg.id === "gmail"
                  ? "Provide your Google OAuth credentials. They are stored privately for your account and masked after save."
                  : activeIntg.id === "slack"
                  ? "Slack receives a notification when Gmail finds a new inbound message."
                  : "Webhook secret is used to validate incoming Google Voice events."}
              </p>

              {activeIntg.configFields.map((field) => {
                const isEditingSecret = field.secret && editingFields.has(field.key);
                const hasSavedValue = !!savedConfigs[activeIntg.id]?.fields?.[field.key];
                return (
                  <div key={field.key} className="space-y-1.5">
                    <Label className="flex items-center gap-2">
                      {field.label}
                      {field.secret && <Lock className="h-3 w-3 text-muted-foreground" />}
                      {field.optional && <span className="text-[10px] text-muted-foreground">(optional)</span>}
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        type={isEditingSecret ? "password" : field.type || "text"}
                        placeholder={field.placeholder}
                        value={draftConfig[field.key] || ""}
                        onChange={(e) => handleFieldChange(field.key, e.target.value, field.secret)}
                        autoComplete="off"
                        spellCheck={false}
                        readOnly={field.secret && hasSavedValue && !isEditingSecret}
                        maxLength={500}
                      />
                      {field.secret && hasSavedValue && !isEditingSecret && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setDraftConfig((prev) => ({ ...prev, [field.key]: "" }));
                            setEditingFields((prev) => new Set(prev).add(field.key));
                          }}
                        >
                          Replace
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}

              <Button className="w-full" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save Configuration"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Integrations;
