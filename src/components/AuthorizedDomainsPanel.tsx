import React, { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, ShieldCheck } from "lucide-react";

/**
 * Webmaster-only panel for managing Firebase Auth authorized domains.
 * Backed by the `listAuthorizedDomains` / `addAuthorizedDomain` /
 * `removeAuthorizedDomain` Cloud Functions, which call the Identity Toolkit
 * Admin API with the function's service-account credentials.
 *
 * Authorized domains gate `sendPasswordResetEmail` continueURLs — without the
 * current host in this list Firebase returns `auth/unauthorized-continue-uri`.
 */
const AuthorizedDomainsPanel: React.FC = () => {
  const { toast } = useToast();
  const [domains, setDomains] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDomain, setNewDomain] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const currentHost = useMemo(() => window.location.hostname, []);
  const currentMissing = currentHost && !domains.includes(currentHost);

  const load = async () => {
    setLoading(true);
    try {
      const fn = httpsCallable<unknown, { domains: string[] }>(functions, "listAuthorizedDomains");
      const res = await fn({});
      setDomains(res.data.domains ?? []);
    } catch (err: any) {
      toast({
        title: "Could not load authorized domains",
        description: err?.message ?? "Cloud Function unavailable.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const add = async (domain: string) => {
    const value = domain.trim().toLowerCase();
    if (!value) return;
    setBusy(value);
    try {
      const fn = httpsCallable<{ domain: string }, { domains: string[] }>(functions, "addAuthorizedDomain");
      const res = await fn({ domain: value });
      setDomains(res.data.domains ?? []);
      setNewDomain("");
      toast({ title: "Domain added", description: value });
    } catch (err: any) {
      toast({ title: "Failed to add domain", description: err?.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (domain: string) => {
    setBusy(domain);
    try {
      const fn = httpsCallable<{ domain: string }, { domains: string[] }>(functions, "removeAuthorizedDomain");
      const res = await fn({ domain });
      setDomains(res.data.domains ?? []);
      toast({ title: "Domain removed", description: domain });
    } catch (err: any) {
      toast({ title: "Failed to remove domain", description: err?.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          Firebase authorized domains
        </CardTitle>
        <CardDescription>
          Hostnames allowed to receive password-reset and other Firebase Auth continue URLs.
          Add the preview, published, and custom-domain hosts for this project.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentMissing && !loading && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            The current host <strong>{currentHost}</strong> is not in the authorized list — password
            reset will fail from this domain.
            <Button
              size="sm"
              variant="outline"
              className="ml-2"
              disabled={busy === currentHost}
              onClick={() => add(currentHost)}
            >
              Add this domain
            </Button>
          </div>
        )}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add(newDomain);
          }}
        >
          <Input
            placeholder="example.com"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            aria-label="New authorized domain"
          />
          <Button type="submit" disabled={!newDomain.trim() || busy !== null}>
            {busy === newDomain.trim().toLowerCase() ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add
          </Button>
        </form>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <ul className="space-y-2">
            {domains.map((d) => {
              const required = d === "localhost" || d.endsWith(".firebaseapp.com") || d.endsWith(".web.app");
              return (
                <li
                  key={d}
                  className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{d}</span>
                    {required && <Badge variant="secondary">required</Badge>}
                    {d === currentHost && <Badge>current</Badge>}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={required || busy === d}
                    onClick={() => remove(d)}
                    aria-label={`Remove ${d}`}
                  >
                    {busy === d ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </li>
              );
            })}
            {domains.length === 0 && (
              <li className="text-sm text-muted-foreground">No authorized domains found.</li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

export default AuthorizedDomainsPanel;
