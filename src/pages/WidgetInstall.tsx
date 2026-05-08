import React, { useEffect, useMemo, useState } from "react";
import { Copy, Check, Code2, RefreshCw, Save, ShieldCheck, AlertTriangle } from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { doc, onSnapshot } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { functions, db } from "@/lib/firebase";

/**
 * Admin/webmaster page that manages the embeddable customer chat widget
 * tenant config (siteKey + theme + allowedOrigins) and shows the install
 * snippet. Backed by `widgetConfigs/{tenantId}` and the
 * `upsertWidgetConfig` / `rotateWidgetSiteKey` callables.
 */
type WidgetConfig = {
  tenantId: string;
  siteKey: string;
  allowedOrigins: string[];
  theme: { color: string; position: "left" | "right" };
  enabled: boolean;
  requireConsent: boolean;
};

const sanitizeTenantId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);

const WidgetInstall: React.FC = () => {
  const { profile } = useAuth();
  const [tenant, setTenant] = useState(() => sanitizeTenantId(profile?.uid ?? "default"));
  const [color, setColor] = useState("#E07A5F");
  const [position, setPosition] = useState<"left" | "right">("right");
  const [enabled, setEnabled] = useState(true);
  const [requireConsent, setRequireConsent] = useState(true);
  const [originsText, setOriginsText] = useState("");
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "https://app.convohub.dev";

  // Live-load existing config so two admins editing in parallel converge.
  useEffect(() => {
    if (!tenant || tenant.length < 3) { setConfig(null); return; }
    const unsub = onSnapshot(doc(db, "widgetConfigs", tenant), (snap) => {
      if (!snap.exists()) { setConfig(null); return; }
      const d = snap.data() as any;
      const cfg: WidgetConfig = {
        tenantId: tenant,
        siteKey: d.siteKey || "",
        allowedOrigins: Array.isArray(d.allowedOrigins) ? d.allowedOrigins : [],
        theme: { color: d.theme?.color || "#E07A5F", position: d.theme?.position === "left" ? "left" : "right" },
        enabled: d.enabled !== false,
        requireConsent: d.requireConsent !== false,
      };
      setConfig(cfg);
      setColor(cfg.theme.color);
      setPosition(cfg.theme.position);
      setEnabled(cfg.enabled);
      setRequireConsent(cfg.requireConsent);
      setOriginsText(cfg.allowedOrigins.join("\n"));
    });
    return () => unsub();
  }, [tenant]);

  const snippet = useMemo(() => {
    const siteKey = config?.siteKey || "<saved-on-first-save>";
    return `<!-- ConvoHub chat widget -->\n<script async\n  src="${origin}/widget/v1/convohub-widget.js"\n  data-tenant="${tenant}"\n  data-site-key="${siteKey}"\n  data-color="${color}"></script>`;
  }, [origin, tenant, color, config?.siteKey]);

  const save = async () => {
    if (tenant.length < 3) {
      toast({ title: "Invalid tenant id", description: "3–64 chars, letters/numbers/_/- only.", variant: "destructive" });
      return;
    }
    const allowedOrigins = originsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    setSaving(true);
    try {
      const fn = httpsCallable<
        { tenantId: string; allowedOrigins: string[]; theme: { color: string; position: string }; enabled: boolean; requireConsent: boolean },
        { ok: boolean; siteKey: string }
      >(functions, "upsertWidgetConfig");
      const res = await fn({ tenantId: tenant, allowedOrigins, theme: { color, position }, enabled, requireConsent });
      toast({ title: "Saved", description: `Widget config saved. Site key: ${res.data.siteKey.slice(0, 12)}…` });
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message || "Could not save.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const rotate = async () => {
    if (!config) { toast({ title: "Save first", description: "Create the config before rotating." }); return; }
    if (!confirm("Rotate the site key? Every existing install snippet will stop working until you redeploy with the new key.")) return;
    setRotating(true);
    try {
      const fn = httpsCallable<{ tenantId: string }, { ok: boolean; siteKey: string }>(functions, "rotateWidgetSiteKey");
      const res = await fn({ tenantId: tenant });
      toast({ title: "Rotated", description: `New site key: ${res.data.siteKey.slice(0, 12)}…` });
    } catch (e: any) {
      toast({ title: "Rotation failed", description: e?.message || "Try again.", variant: "destructive" });
    } finally {
      setRotating(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      toast({ title: "Copied", description: "Snippet copied to clipboard." });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", description: "Select the snippet manually.", variant: "destructive" });
    }
  };

  const originsValid = originsText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .every((o) => {
      try { const u = new URL(o); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; }
    });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Code2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
            Embeddable chat widget
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure where the widget may run, customize the look, and copy the install snippet.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tenant</CardTitle>
          <CardDescription>Each tenant id has its own site key and allow-list.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="tenant">Tenant id</Label>
            <Input id="tenant" value={tenant} onChange={(e) => setTenant(sanitizeTenantId(e.target.value))} placeholder="e.g. acme-prod" />
            <p className="mt-1 text-xs text-muted-foreground">3–64 chars, letters / numbers / underscore / dash.</p>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">Site key</p>
              <p className="text-xs text-muted-foreground break-all">{config?.siteKey || "Not yet generated. Save to create."}</p>
            </div>
            <Button onClick={rotate} variant="outline" size="sm" disabled={rotating || !config}>
              <RefreshCw className="mr-1 h-4 w-4" />Rotate
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>Restrict where this widget may load.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="origins">Allowed origins (one per line)</Label>
            <Textarea
              id="origins"
              rows={4}
              value={originsText}
              onChange={(e) => setOriginsText(e.target.value)}
              placeholder={"https://example.com\nhttps://www.example.com"}
            />
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              {originsValid ? <ShieldCheck className="h-3 w-3 text-emerald-600" /> : <AlertTriangle className="h-3 w-3 text-amber-600" />}
              {originsValid ? "All entries look valid." : "One or more entries aren't valid URLs."}
              {" "}Leave empty to allow any origin (not recommended).
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Widget enabled</Label>
              <p className="text-xs text-muted-foreground">Disable to instantly stop accepting new chats from any installed snippet.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Require explicit consent</Label>
              <p className="text-xs text-muted-foreground">Visitors must tick the privacy/terms checkbox before chatting.</p>
            </div>
            <Switch checked={requireConsent} onCheckedChange={setRequireConsent} />
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Theme</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="color">Accent color</Label>
            <div className="flex gap-2">
              <Input id="color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-16 p-1" />
              <Input value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="position">Bubble position</Label>
            <select
              id="position"
              value={position}
              onChange={(e) => setPosition(e.target.value === "left" ? "left" : "right")}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="right">Bottom right</option>
              <option value="left">Bottom left</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 flex justify-end">
        <Button onClick={save} disabled={saving}>
          <Save className="mr-1 h-4 w-4" />{saving ? "Saving…" : "Save configuration"}
        </Button>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Install snippet</CardTitle>
            <CardDescription>Place inside <code>&lt;body&gt;</code>, just before the closing tag.</CardDescription>
          </div>
          <Button onClick={copy} variant="outline" size="sm" disabled={!config}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs leading-relaxed text-foreground">
            <code>{snippet}</code>
          </pre>
          <p className="mt-3 text-xs text-muted-foreground">
            Customer messages stream into the same Conversations inbox as your other channels.
            Each new visitor creates a fresh thread; returning visitors on the same browser resume their existing thread automatically.
            The site key is public — security comes from the allow-listed origins above.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default WidgetInstall;
