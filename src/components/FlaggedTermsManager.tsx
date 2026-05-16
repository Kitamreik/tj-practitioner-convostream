import React, { useState } from "react";
import { Plus, Trash2, ShieldAlert, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  addFlaggedTerm,
  removeFlaggedTerm,
  useFlaggedTerms,
  DEFAULT_FLAGGED_TERMS,
} from "@/lib/flaggedTerms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

/**
 * Webmaster-only manager for the flagged-terms wordlist. Terms saved here
 * live in Firestore (`flagged_terms`) and are merged with the built-in
 * defaults at runtime — so removing a built-in default from the UI has no
 * effect (the defaults always apply). The UI surfaces both groups for
 * clarity.
 */
const FlaggedTermsManager: React.FC = () => {
  const { profile } = useAuth();
  const isWebmaster = profile?.role === "webmaster";
  const { docs, loading } = useFlaggedTerms();
  const [newTerm, setNewTerm] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!isWebmaster) return null;

  const handleAdd = async () => {
    const t = newTerm.trim();
    if (!t) return;
    setAdding(true);
    try {
      await addFlaggedTerm(t, "medium", profile?.uid);
      setNewTerm("");
      toast({ title: "Term added", description: t });
    } catch (e: any) {
      toast({ title: "Couldn't add", description: e?.message, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: string, term: string) => {
    if (!confirm(`Remove "${term}" from the flagged list?`)) return;
    setBusyId(id);
    try {
      await removeFlaggedTerm(id);
    } catch (e: any) {
      toast({ title: "Couldn't remove", description: e?.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            Flagged terms
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Outgoing messages containing any of these words trigger an
            auto-posted Staff Update with a screenshot.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          value={newTerm}
          onChange={(e) => setNewTerm(e.target.value)}
          placeholder="Add a term…"
          onKeyDown={(e) => e.key === "Enter" && !adding && handleAdd()}
          disabled={adding}
          className="h-9"
        />
        <Button onClick={handleAdd} disabled={adding || !newTerm.trim()} className="gap-1.5">
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            Custom ({docs.length})
          </p>
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No custom terms yet. The defaults below are always active.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {docs.map((d) => (
                <Badge
                  key={d.id}
                  variant="outline"
                  className="gap-1.5 pl-2 pr-1 py-0.5 text-xs"
                >
                  {d.term}
                  <button
                    type="button"
                    onClick={() => handleRemove(d.id, d.term)}
                    disabled={busyId === d.id}
                    aria-label={`Remove ${d.term}`}
                    className="rounded p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    {busyId === d.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Built-in defaults ({DEFAULT_FLAGGED_TERMS.length})
          </summary>
          <div className="mt-2 flex flex-wrap gap-1">
            {DEFAULT_FLAGGED_TERMS.map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
};

export default FlaggedTermsManager;
