import React, { useMemo, useState } from "react";
import { Eye, EyeOff, Check, X, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

/**
 * EnvVarsPanel — read-only diagnostics view of every `VITE_*` env var Vite
 * exposed to the browser bundle at build time. We surface this on the
 * Settings page so any signed-in user can quickly verify that values
 * loaded from `.env.local` (or Lovable Project Secrets) are actually
 * baked into the running app.
 *
 * Security: by definition `VITE_*` vars ship in the JS bundle and are
 * already public. We still mask each value by default and only reveal it
 * on explicit user action so they don't show up in screen-sharing /
 * screenshots by accident.
 *
 * Important: `import.meta.env` is statically analyzed by Vite at build
 * time — we have to enumerate the well-known keys explicitly so the
 * bundler keeps them in the output.
 */

interface ExpectedVar {
  name: string;
  description: string;
  value: string | undefined;
  /** When true, the value is sensitive enough to keep masked by default. */
  sensitive?: boolean;
}

function maskValue(v: string): string {
  if (!v) return "";
  if (v.length <= 6) return "•".repeat(v.length);
  return `${v.slice(0, 3)}${"•".repeat(Math.min(v.length - 6, 24))}${v.slice(-3)}`;
}

const EnvVarsPanel: React.FC = () => {
  // List the VITE_* keys we actively read elsewhere. Because Vite replaces
  // `import.meta.env.VITE_*` references at build time, we MUST reference
  // each one statically — a dynamic lookup like `import.meta.env[name]`
  // would only resolve at runtime and always come back undefined in prod.
  const expected: ExpectedVar[] = useMemo(
    () => [
      {
        name: "VITE_FIREBASE_API_KEY",
        description: "Firebase Web API key (publishable, but masked by default).",
        value: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
        sensitive: true,
      },
      {
        name: "VITE_FIREBASE_AUTH_DOMAIN",
        description: "Firebase Auth domain.",
        value: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
      },
      {
        name: "VITE_FIREBASE_PROJECT_ID",
        description: "Firebase project id (drives Firestore + Functions URLs).",
        value: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
      },
      {
        name: "VITE_FIREBASE_STORAGE_BUCKET",
        description: "Firebase Storage bucket.",
        value: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
      },
      {
        name: "VITE_FIREBASE_MESSAGING_SENDER_ID",
        description: "Firebase Cloud Messaging sender id.",
        value: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
      },
      {
        name: "VITE_FIREBASE_APP_ID",
        description: "Firebase Web App id.",
        value: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
        sensitive: true,
      },
      {
        name: "VITE_WEBMASTER_PHONE_E164",
        description: "On-call webmaster number (E.164) used by Call/Text shortcuts.",
        value: import.meta.env.VITE_WEBMASTER_PHONE_E164 as string | undefined,
      },
      {
        name: "VITE_WEBMASTER_PHONE_DISPLAY",
        description: "Human-readable form of the on-call webmaster number.",
        value: import.meta.env.VITE_WEBMASTER_PHONE_DISPLAY as string | undefined,
      },
    ],
    []
  );

  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const toggle = (name: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const copy = async (name: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${name} copied` });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const configuredCount = expected.filter((e) => !!e.value).length;
  const buildMode = (import.meta.env.MODE as string) || "unknown";

  return (
    <div id="env-vars" className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground">
            <KeyRound className="h-5 w-5 text-primary" />
            Environment variables
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            VITE_* variables baked into this build. Values below are read directly from
            <code className="mx-1 rounded bg-muted px-1 text-xs">import.meta.env</code>
            so you can verify your <code className="mx-1 rounded bg-muted px-1 text-xs">.env.local</code>
            (or Lovable Project Secrets) actually shipped.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            mode: {buildMode}
          </Badge>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            {configuredCount}/{expected.length} configured
          </Badge>
        </div>
      </div>

      <div className="space-y-2">
        {expected.map((row) => {
          const present = !!row.value;
          const show = revealed.has(row.name);
          const display = present
            ? show || !row.sensitive
              ? row.value!
              : maskValue(row.value!)
            : "(not set)";
          return (
            <div
              key={row.name}
              className="rounded-lg border border-border bg-background p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <code className="text-xs font-mono text-foreground break-all">
                  {row.name}
                </code>
                {present ? (
                  <Badge className="gap-1 border-success/30 bg-success/10 text-success text-[10px]">
                    <Check className="h-3 w-3" /> set
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="gap-1 border-destructive/30 text-destructive text-[10px]"
                  >
                    <X className="h-3 w-3" /> missing
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{row.description}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code
                  className={`flex-1 min-w-0 rounded border border-border bg-muted/40 px-2 py-1 text-xs font-mono break-all ${
                    present ? "text-foreground" : "text-muted-foreground italic"
                  }`}
                >
                  {display}
                </code>
                {present && row.sensitive && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => toggle(row.name)}
                    aria-label={show ? `Hide ${row.name}` : `Reveal ${row.name}`}
                  >
                    {show ? (
                      <>
                        <EyeOff className="h-3 w-3" /> Hide
                      </>
                    ) : (
                      <>
                        <Eye className="h-3 w-3" /> Reveal
                      </>
                    )}
                  </Button>
                )}
                {present && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => copy(row.name, row.value!)}
                    aria-label={`Copy ${row.name}`}
                  >
                    <Copy className="h-3 w-3" />
                    Copy
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default EnvVarsPanel;
