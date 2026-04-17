import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { MessageSquare, Phone, Mail, Hash, Check, Settings, X, Lock, Webhook, Copy, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
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
      { key: "clientId", label: "OAuth Client ID", placeholder: "xxxx.apps.googleusercontent.com", type: "password", secret: true, schema: googleClientIdSchema },
      { key: "clientSecret", label: "OAuth Client Secret", placeholder: "GOCSPX-xxxxxxxx", type: "password", secret: true, schema: oauthSecretSchema },
      { key: "redirectUri", label: "Redirect URI", placeholder: "https://your-app.com/auth/gmail/callback", type: "url", schema: httpsUrlSchema },
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
  const { user } = useAuth();
  const [configOpen, setConfigOpen] = useState<string | null>(null);
  const [savedConfigs, setSavedConfigs] = useState<Record<string, IntegrationConfig>>({});
  const [draftConfig, setDraftConfig] = useState<Record<string, string>>({});
  const [editingFields, setEditingFields] = useState<Set<string>>(new Set());
  const [loadingConfigs, setLoadingConfigs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [simulating, setSimulating] = useState<"call" | "sms" | null>(null);

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

  // ----- Google Voice webhook simulator -----
  const webhookUrl = `${window.location.origin}/api/google-voice/webhook`;

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

      {/* Google Voice Webhook Contract */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="rounded-xl border border-border bg-card p-6 mb-8">
        <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2 mb-2">
          <Webhook className="h-5 w-5 text-primary" />
          Google Voice Webhook Contract
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Forward Google Voice events (calls + SMS) into Firestore so they appear live in the Analytics dashboard. Use Zapier, IFTTT, Apps Script, or your own server to POST events to:
        </p>

        <div className="rounded-lg border border-border bg-muted/40 p-3 mb-4 flex items-center justify-between gap-2">
          <code className="text-xs font-mono text-foreground break-all">{webhookUrl}</code>
          <Button variant="ghost" size="sm" onClick={copyWebhookUrl} aria-label="Copy URL">
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>

        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Expected JSON payload</p>
        <pre className="rounded-lg bg-muted/60 p-4 text-xs overflow-x-auto font-mono mb-4">
{`{
  "type": "call_inbound" | "call_outbound" | "sms_inbound" | "sms_outbound",
  "contact": "+15551234567",
  "durationSec": 184,        // calls only
  "preview": "Message text", // SMS only
  "secret": "<webhookSecret from settings>"
}`}
        </pre>

        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-foreground mb-4">
          <p className="font-medium mb-1">⚠️ Until a webhook receiver is deployed</p>
          <p className="text-muted-foreground">
            You can write events directly into the <code className="bg-muted px-1 rounded">googleVoiceActivity</code> Firestore collection from any
            authenticated client (Apps Script, Cloud Function, etc.) using the same shape above. The Analytics page listens to this collection in real time.
          </p>
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
          <p className="text-xs text-muted-foreground self-center">Test events appear instantly on the Analytics page.</p>
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
