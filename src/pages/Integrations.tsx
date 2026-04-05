import React, { useState } from "react";
import { motion } from "framer-motion";
import { MessageSquare, Phone, Mail, Hash, ExternalLink, Check, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  status: "connected" | "available";
  provider: string;
  configFields?: { key: string; label: string; placeholder: string; type?: string }[];
}

const integrations: Integration[] = [
  {
    id: "google-voice",
    name: "Google Voice",
    description: "Make and receive calls and SMS via Google Voice. Integrates with your Google Workspace account.",
    icon: <Phone className="h-6 w-6" />,
    status: "available",
    provider: "Google Workspace",
    configFields: [
      { key: "googleAccount", label: "Google Account Email", placeholder: "you@yourdomain.com" },
      { key: "voiceNumber", label: "Google Voice Number", placeholder: "+15551234567" },
      { key: "clientId", label: "OAuth Client ID", placeholder: "xxxx.apps.googleusercontent.com" },
      { key: "clientSecret", label: "OAuth Client Secret", placeholder: "GOCSPX-xxxxxxxx", type: "password" },
    ],
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Sync email conversations and send replies without leaving ConvoHub. Uses Gmail API via Firebase.",
    icon: <Mail className="h-6 w-6" />,
    status: "available",
    provider: "Google Workspace",
    configFields: [
      { key: "clientId", label: "OAuth Client ID", placeholder: "xxxx.apps.googleusercontent.com" },
      { key: "clientSecret", label: "OAuth Client Secret", placeholder: "GOCSPX-xxxxxxxx", type: "password" },
      { key: "redirectUri", label: "Redirect URI", placeholder: "https://your-app.com/auth/gmail/callback" },
      { key: "syncEmail", label: "Gmail Address to Sync", placeholder: "support@yourbrand.com" },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Get notifications in Slack channels and collaborate on customer threads. Connected via Firebase.",
    icon: <Hash className="h-6 w-6" />,
    status: "available",
    provider: "Slack API",
    configFields: [
      { key: "webhookUrl", label: "Slack Webhook URL", placeholder: "https://hooks.slack.com/services/T.../B.../xxxx" },
      { key: "defaultChannel", label: "Default Channel", placeholder: "#support" },
      { key: "botToken", label: "Bot Token (optional)", placeholder: "xoxb-xxxx", type: "password" },
    ],
  },
];

const Integrations: React.FC = () => {
  const { toast } = useToast();
  const [configOpen, setConfigOpen] = useState<string | null>(null);
  const [configs, setConfigs] = useState<Record<string, Record<string, string>>>({});
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());

  const activeIntg = integrations.find((i) => i.id === configOpen);

  const handleSave = () => {
    if (!configOpen) return;
    const cfg = configs[configOpen] || {};
    const fields = activeIntg?.configFields || [];
    const missing = fields.filter((f) => !f.key.includes("optional") && !cfg[f.key]?.trim());
    if (missing.length > 0) {
      toast({ title: "Missing required fields", description: `Please fill in: ${missing.map((f) => f.label).join(", ")}`, variant: "destructive" });
      return;
    }
    setConnectedIds((prev) => new Set(prev).add(configOpen));
    toast({ title: `${activeIntg?.name} configured`, description: "Integration settings saved. Connect via Firebase Console to activate." });
    setConfigOpen(null);
  };

  const handleDisconnect = (id: string) => {
    setConnectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setConfigs((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    toast({ title: "Integration disconnected" });
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Integrations</h1>
        <p className="text-muted-foreground mt-1">Connect your communication channels</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {integrations.map((intg, i) => {
          const isConnected = connectedIds.has(intg.id);
          return (
            <motion.div
              key={intg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="rounded-xl border border-border bg-card p-6 flex flex-col"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  {intg.icon}
                </div>
                <div className="flex items-center gap-2">
                  {isConnected && (
                    <Badge className="bg-green-500/10 text-green-600 border-green-500/20 text-xs gap-1">
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
                <Button
                  variant={isConnected ? "outline" : "default"}
                  className="flex-1 gap-2"
                  onClick={() => setConfigOpen(intg.id)}
                >
                  <Settings className="h-3.5 w-3.5" />
                  {isConnected ? "Settings" : "Configure"}
                </Button>
                {isConnected && (
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDisconnect(intg.id)}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      <Dialog open={!!configOpen} onOpenChange={(o) => !o && setConfigOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure {activeIntg?.name}</DialogTitle>
          </DialogHeader>
          {activeIntg && (
            <div className="space-y-4 mt-2">
              <p className="text-sm text-muted-foreground">
                {activeIntg.id === "gmail"
                  ? "Set up Gmail sync by providing your Google OAuth credentials. Enable the Gmail API in your Google Cloud Console and add the redirect URI."
                  : activeIntg.id === "slack"
                  ? "Enter your Slack webhook URL from Firebase Extensions or your Slack app settings to receive notifications."
                  : `Enter your ${activeIntg.provider} credentials to connect.`}
              </p>
              {activeIntg.configFields?.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label>{field.label}</Label>
                  <Input
                    type={field.type || "text"}
                    placeholder={field.placeholder}
                    value={configs[activeIntg.id]?.[field.key] || ""}
                    onChange={(e) =>
                      setConfigs((prev) => ({
                        ...prev,
                        [activeIntg.id]: { ...prev[activeIntg.id], [field.key]: e.target.value },
                      }))
                    }
                  />
                </div>
              ))}
              {activeIntg.id === "gmail" && (
                <div className="rounded-lg bg-muted/50 p-4 text-xs text-muted-foreground space-y-2">
                  <p className="font-medium text-foreground">Gmail Setup Steps:</p>
                  <ol className="list-decimal pl-4 space-y-1">
                    <li>Go to <strong>Google Cloud Console</strong> → APIs & Services → Credentials</li>
                    <li>Create an OAuth 2.0 Client ID (Web application)</li>
                    <li>Add the redirect URI from above to Authorized redirect URIs</li>
                    <li>Enable the <strong>Gmail API</strong> in your project</li>
                    <li>Paste the Client ID and Secret here</li>
                    <li>In Firebase Console, enable the <strong>Gmail extension</strong> or use Cloud Functions</li>
                  </ol>
                </div>
              )}
              <Button className="w-full" onClick={handleSave}>
                Save Configuration
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Integrations;
