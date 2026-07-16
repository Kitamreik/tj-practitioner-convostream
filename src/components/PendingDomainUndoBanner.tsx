import React, { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCcw, X, ShieldCheck } from "lucide-react";
import {
  listPendingDomainUndos,
  subscribePendingDomainUndos,
  clearPendingDomainUndo,
  UNDO_TTL_MS,
  type PendingDomainUndo,
} from "@/lib/authorizedDomainUndo";
import { useToast } from "@/hooks/use-toast";

/**
 * Floating banner that persists a recent authorized-domain removal for up to
 * 240 seconds AFTER the toast is gone AND across route navigation. Only
 * webmasters see it — matches the callable's server-side authorization gate.
 *
 * The banner ticks down its own countdown and calls
 * `addAuthorizedDomain({ domain })` on click to restore.
 */
const PendingDomainUndoBanner: React.FC = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [entries, setEntries] = useState<PendingDomainUndo[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => subscribePendingDomainUndos(setEntries), []);
  useEffect(() => {
    if (entries.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [entries.length]);

  const live = useMemo(() => entries.filter((e) => e.expiresAt > now), [entries, now]);
  useEffect(() => {
    // Prune expired rows out of storage as they age out.
    entries.filter((e) => e.expiresAt <= now).forEach((e) => clearPendingDomainUndo(e.domain));
  }, [entries, now]);

  if (!profile || profile.role !== "webmaster") return null;
  if (live.length === 0) return null;

  const restore = async (domain: string) => {
    setBusy(domain);
    try {
      const fn = httpsCallable<{ domain: string }, { domains: string[] }>(functions, "addAuthorizedDomain");
      await fn({ domain });
      clearPendingDomainUndo(domain);
      toast({ title: "Domain restored", description: domain });
    } catch (err: any) {
      toast({
        title: "Failed to restore domain",
        description: err?.message ?? "Try again from Settings.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      role="region"
      aria-label="Recent authorized domain removals"
      className="pointer-events-none fixed bottom-20 right-4 z-50 flex w-full max-w-sm flex-col gap-2 md:bottom-4"
    >
      {live.map((entry) => {
        const secondsLeft = Math.max(0, Math.ceil((entry.expiresAt - now) / 1000));
        const pct = Math.max(0, Math.min(100, (secondsLeft / (UNDO_TTL_MS / 1000)) * 100));
        return (
          <div
            key={entry.domain}
            data-testid="domain-undo-banner"
            className="pointer-events-auto overflow-hidden rounded-lg border border-border bg-card p-3 shadow-lg"
          >
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">Authorized domain removed</div>
                <div className="truncate font-mono text-xs text-muted-foreground">{entry.domain}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Undo available for {secondsLeft}s
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === entry.domain}
                  onClick={() => void restore(entry.domain)}
                  aria-label={`Undo removal of ${entry.domain}`}
                >
                  {busy === entry.domain ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  Undo
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Dismiss undo for ${entry.domain}`}
                  onClick={() => clearPendingDomainUndo(entry.domain)}
                  disabled={busy === entry.domain}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PendingDomainUndoBanner;

// Re-export so existing removal helpers can queue an entry without importing
// the lib path directly.
export { listPendingDomainUndos, subscribePendingDomainUndos };
