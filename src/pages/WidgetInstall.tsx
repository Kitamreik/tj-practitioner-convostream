import React, { useMemo, useState } from "react";
import { Copy, Check, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

/**
 * Admin/webmaster-facing page that shows the install snippet for the
 * embeddable customer chat widget. The widget bundle is served from the
 * app origin at /widget/v1/convohub-widget.js.
 */
const WidgetInstall: React.FC = () => {
  const { profile } = useAuth();
  const [tenant, setTenant] = useState(() => (profile?.uid ?? "default").slice(0, 32));
  const [color, setColor] = useState("#E07A5F");
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "https://app.convohub.dev";
  const snippet = useMemo(
    () =>
      `<!-- ConvoHub chat widget -->\n<script async\n  src="${origin}/widget/v1/convohub-widget.js"\n  data-tenant="${tenant}"\n  data-color="${color}"\n  data-endpoint="${origin}/api/widget"></script>`,
    [origin, tenant, color],
  );

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

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Code2 className="h-5 w-5" />
        </div>
        <div>
          <h1
            className="text-2xl font-semibold text-foreground"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Embeddable chat widget
          </h1>
          <p className="text-sm text-muted-foreground">
            Paste this snippet on any customer site. Visitors get a chat bubble that
            opens a thread directly in your Conversations inbox.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Customize</CardTitle>
          <CardDescription>Tenant id is included in every conversation as <code>widgetTenantId</code>.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="tenant">Tenant id</Label>
              <Input id="tenant" value={tenant} onChange={(e) => setTenant(e.target.value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32))} />
            </div>
            <div>
              <Label htmlFor="color">Accent color</Label>
              <div className="flex gap-2">
                <Input id="color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-16 p-1" />
                <Input value={color} onChange={(e) => setColor(e.target.value)} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Install snippet</CardTitle>
            <CardDescription>Place inside <code>&lt;body&gt;</code>, just before the closing tag.</CardDescription>
          </div>
          <Button onClick={copy} variant="outline" size="sm">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs leading-relaxed text-foreground">
            <code>{snippet}</code>
          </pre>
          <p className="mt-3 text-xs text-muted-foreground">
            Customer messages stream into the same Conversations inbox as your other
            channels. Each new visitor creates a fresh thread; returning visitors on
            the same browser resume their existing thread automatically.
          </p>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Try it here</CardTitle>
          <CardDescription>Loads the widget in this page so you can preview the experience.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => {
              const existing = document.getElementById("convohub-widget-script");
              if (existing) existing.remove();
              const s = document.createElement("script");
              s.id = "convohub-widget-script";
              s.async = true;
              s.src = `/widget/v1/convohub-widget.js`;
              s.dataset.tenant = tenant;
              s.dataset.color = color;
              document.body.appendChild(s);
              toast({ title: "Widget loaded", description: "Look bottom-right." });
            }}
          >
            Load widget on this page
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default WidgetInstall;
