import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { ShieldAlert, CloudUpload, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import WebmasterContactButtons from "@/components/WebmasterContactButtons";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import {
  appendEscalationEntry,
  clearEscalationEntries,
  installEscalationOnlineRetry,
  listEscalationEntries,
  listPendingEscalationEntries,
  pushEscalationLogToFirestore,
  type EscalationEntry,
} from "@/lib/escalationLog";

/**
 * EscalateWebmasterModal — MVP-level escalation flow.
 *
 * Replaces the legacy always-visible Call/Text shortcut row with a focused
 * modal. The incident note is auto-saved to localStorage AND, on submit,
 * appended to the per-user escalation queue (also localStorage). Submitting
 * never blocks on Firestore, so the flow stays functional during outages or
 * permission glitches — the existing WebmasterContactButtons still launches
 * the OS dialer / SMS composer alongside.
 *
 * Webmasters see an extra "Push escalation logs to Firestore" button that
 * flushes their queue into `webmasterContactEvents` (channel="escalation")
 * so the timeline panel on /settings stays authoritative.
 */
const DRAFT_KEY_PREFIX = "ConvoHub.webmasterEscalate.draft.";

interface Props {
  className?: string;
}

const EscalateWebmasterModal: React.FC<Props> = ({ className }) => {
  const { profile, user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState<EscalationEntry[]>([]);
  const [pushing, setPushing] = useState(false);
  const [logging, setLogging] = useState(false);

  const draftKey = profile?.uid ? DRAFT_KEY_PREFIX + profile.uid : null;
  const uid = profile?.uid ?? user?.uid ?? null;
  const isWebmaster = profile?.role === "webmaster";

  // Hydrate the draft + entries on open.
  useEffect(() => {
    if (!open) return;
    if (draftKey) {
      try { setNote(localStorage.getItem(draftKey) ?? ""); } catch { /* private */ }
    }
    if (uid) setEntries(listEscalationEntries(uid));
  }, [open, draftKey, uid]);

  useEffect(() => {
    if (!draftKey) return;
    try {
      if (note) localStorage.setItem(draftKey, note);
      else localStorage.removeItem(draftKey);
    } catch { /* private mode */ }
  }, [note, draftKey]);

  const pendingCount = useMemo(
    () => entries.filter((e) => e.syncedAt === null).length,
    [entries],
  );

  if (!profile || profile.role === "customer") return null;

  const handleLogEscalation = () => {
    if (!uid || !note.trim()) return;
    setLogging(true);
    try {
      appendEscalationEntry({
        agentUid: uid,
        agentName: profile.displayName || profile.email || "Unknown",
        agentEmail: profile.email ?? null,
        route: location.pathname + location.search,
        note: note.trim(),
      });
      setEntries(listEscalationEntries(uid));
      setNote("");
      try { if (draftKey) localStorage.removeItem(draftKey); } catch { /* ignore */ }
      toast({ title: "Escalation logged", description: "Saved locally. A webmaster can push it to Firestore." });
    } finally {
      setLogging(false);
    }
  };

  const handleCopyNote = async () => {
    if (!note.trim()) return;
    try { await navigator.clipboard.writeText(note.trim()); } catch { /* clipboard unavailable */ }
  };

  const handlePush = async () => {
    if (!uid) return;
    setPushing(true);
    try {
      const count = await pushEscalationLogToFirestore(uid);
      setEntries(listEscalationEntries(uid));
      toast({
        title: count > 0 ? "Pushed to Firestore" : "Nothing to push",
        description: count > 0
          ? `${count} escalation log entr${count === 1 ? "y" : "ies"} synced.`
          : "All entries already synced.",
      });
    } catch (err) {
      toast({
        title: "Push failed",
        description: (err as { message?: string }).message ?? "Unknown error.",
        variant: "destructive",
      });
    } finally {
      setPushing(false);
    }
  };

  const handleClearSynced = () => {
    if (!uid) return;
    const remaining = entries.filter((e) => e.syncedAt === null);
    if (remaining.length === entries.length) return;
    // Re-write only the remaining (un-synced) entries.
    clearEscalationEntries(uid);
    remaining.forEach((e) => {
      appendEscalationEntry({
        agentUid: e.agentUid,
        agentName: e.agentName,
        agentEmail: e.agentEmail,
        route: e.route,
        note: e.note,
      });
    });
    setEntries(listEscalationEntries(uid));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={["w-full justify-center gap-2", className].filter(Boolean).join(" ")}
          aria-label="Escalate to webmaster"
        >
          <ShieldAlert className="h-4 w-4 text-warning" />
          Escalate to Webmaster
          {pendingCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
              {pendingCount}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-warning" /> Escalate to Webmaster
          </DialogTitle>
          <DialogDescription>
            Reach the on-call webmaster directly. Notes are saved on this device first
            so nothing is lost if Firestore is unreachable.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="escalate-note" className="text-xs">
              Incident note (saved locally)
            </Label>
            <Textarea
              id="escalate-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What’s happening? Who’s affected? What do you need?"
              rows={4}
            />
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">
                {note ? "Draft auto-saved on this device." : "Draft will auto-save as you type."}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={!note.trim()}
                  onClick={handleCopyNote}
                >
                  Copy
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={!note.trim() || logging}
                  onClick={handleLogEscalation}
                >
                  Log escalation
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
              <ListChecks className="h-3.5 w-3.5" /> Local log
              <Badge variant="outline" className="ml-auto h-4 px-1 text-[10px]">
                {entries.length} total · {pendingCount} pending
              </Badge>
            </p>
            {entries.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No escalations logged yet.</p>
            ) : (
              <ul className="max-h-32 space-y-1 overflow-y-auto text-[11px]">
                {entries.slice(0, 5).map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-2 border-b border-border/40 pb-1 last:border-b-0">
                    <span className="line-clamp-1 flex-1 text-muted-foreground">{e.note}</span>
                    <Badge variant={e.syncedAt ? "secondary" : "outline"} className="h-4 px-1 text-[9px]">
                      {e.syncedAt ? "synced" : "pending"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            {isWebmaster && (
              <div className="mt-2 flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-xs"
                  disabled={pushing || pendingCount === 0}
                  onClick={handlePush}
                >
                  <CloudUpload className="h-3 w-3" />
                  {pushing ? "Pushing…" : `Push ${pendingCount} to Firestore`}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={handleClearSynced}
                  disabled={entries.every((e) => e.syncedAt === null)}
                >
                  Clear synced
                </Button>
              </div>
            )}
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="mb-2 text-xs font-medium text-foreground">Contact channels</p>
            <WebmasterContactButtons variant="full" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EscalateWebmasterModal;
