import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Megaphone,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  Wrench,
  Activity,
  Lock,
} from "lucide-react";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { notifyAllUsers } from "@/lib/notifyAll";

/**
 * Staff Updates — webmaster-authored announcements for the team. Everyone
 * (agents/admins/webmasters) can read; only webmasters can create, change
 * status, or delete. Status tags: ongoing, maintenance, resolved.
 *
 * Firestore path: `staff_updates/{id}` — see firestore.rules for write gating.
 */

type UpdateStatus = "ongoing" | "maintenance" | "resolved";

interface StaffUpdate {
  id: string;
  title: string;
  body: string;
  status: UpdateStatus;
  createdAt?: any;
  authorUid: string;
  authorName: string;
}

const STATUS_META: Record<
  UpdateStatus,
  { label: string; icon: React.ReactNode; className: string }
> = {
  ongoing: {
    label: "Ongoing",
    icon: <Activity className="h-3 w-3" />,
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  },
  maintenance: {
    label: "Maintenance",
    icon: <Wrench className="h-3 w-3" />,
    className: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  },
  resolved: {
    label: "Resolved",
    icon: <CheckCircle2 className="h-3 w-3" />,
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  },
};

const formatRelative = (ts: any): string => {
  const d: Date | null = ts?.toDate ? ts.toDate() : null;
  if (!d) return "just now";
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
};

const StaffUpdates: React.FC = () => {
  const { profile } = useAuth();
  const isWebmaster = profile?.role === "webmaster";

  const [updates, setUpdates] = useState<StaffUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftStatus, setDraftStatus] = useState<UpdateStatus>("ongoing");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, "staff_updates"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setError(null);
        setUpdates(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as StaffUpdate))
        );
        setLoading(false);
      },
      (err) => {
        console.warn("StaffUpdates listener error:", err);
        setError("Could not load staff updates.");
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  const grouped = useMemo(() => {
    const active = updates.filter((u) => u.status !== "resolved");
    const resolved = updates.filter((u) => u.status === "resolved");
    return { active, resolved };
  }, [updates]);

  const resetDraft = () => {
    setDraftTitle("");
    setDraftBody("");
    setDraftStatus("ongoing");
  };

  const handleCreate = async () => {
    if (!isWebmaster || !profile) return;
    const title = draftTitle.trim();
    const body = draftBody.trim();
    if (!title) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await addDoc(collection(db, "staff_updates"), {
        title,
        body,
        status: draftStatus,
        createdAt: serverTimestamp(),
        authorUid: profile.uid,
        authorName: profile.displayName || profile.email || "Webmaster",
      });
      toast({ title: "Update posted", description: title });
      // Fan-out a per-user notification so the bell badge lights up.
      notifyAllUsers({
        type: "alert",
        title: `Staff update: ${title}`,
        description: body || `Status: ${draftStatus}`,
        link: "/staff-updates",
      }).catch(() => undefined);
      resetDraft();
      setDialogOpen(false);
    } catch (e: any) {
      toast({
        title: "Could not post",
        description: e?.message || "Try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (id: string, status: UpdateStatus) => {
    if (!isWebmaster) return;
    setBusyId(id);
    try {
      await updateDoc(doc(db, "staff_updates", id), { status });
    } catch (e: any) {
      toast({
        title: "Could not update status",
        description: e?.message || "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!isWebmaster) return;
    if (!confirm("Delete this update? This cannot be undone.")) return;
    setBusyId(id);
    try {
      await deleteDoc(doc(db, "staff_updates", id));
      toast({ title: "Update deleted" });
    } catch (e: any) {
      toast({
        title: "Could not delete",
        description: e?.message || "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const renderCard = (u: StaffUpdate, idx: number) => {
    const meta = STATUS_META[u.status] ?? STATUS_META.ongoing;
    return (
      <motion.div
        key={u.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: idx * 0.03 }}
        className="rounded-xl border border-border bg-card p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{u.title}</h3>
              <Badge
                variant="outline"
                className={`text-[10px] gap-1 ${meta.className}`}
              >
                {meta.icon}
                {meta.label}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              by {u.authorName} · {formatRelative(u.createdAt)}
            </p>
          </div>
          {isWebmaster && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Select
                value={u.status}
                onValueChange={(v) => handleStatusChange(u.id, v as UpdateStatus)}
                disabled={busyId === u.id}
              >
                <SelectTrigger className="h-7 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ongoing">Ongoing</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                disabled={busyId === u.id}
                onClick={() => handleDelete(u.id)}
                aria-label="Delete update"
              >
                {busyId === u.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          )}
        </div>
        {u.body && (
          <p className="mt-3 whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed">
            {u.body}
          </p>
        )}
      </motion.div>
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24 md:pb-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Megaphone className="h-7 w-7 text-primary" />
            Staff Updates
          </h1>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">
            {isWebmaster
              ? "Post platform announcements for the team."
              : "Announcements from the webmaster about platform changes and maintenance."}
          </p>
        </div>
        {isWebmaster ? (
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> New update
          </Button>
        ) : (
          <Badge variant="secondary" className="gap-1.5">
            <Lock className="h-3 w-3" /> Webmaster posts only
          </Badge>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : updates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Megaphone className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">No updates yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            {isWebmaster
              ? "Click 'New update' to post the first announcement."
              : "When the webmaster posts an update, it will appear here."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.active.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Active
              </h2>
              <div className="space-y-3">
                {grouped.active.map((u, i) => renderCard(u, i))}
              </div>
            </section>
          )}
          {grouped.resolved.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Resolved
              </h2>
              <div className="space-y-3 opacity-80">
                {grouped.resolved.map((u, i) => renderCard(u, i))}
              </div>
            </section>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetDraft(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New staff update</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-foreground">Title</label>
              <Input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="e.g. Slack integration outage"
                className="mt-1"
                disabled={submitting}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground">Details</label>
              <Textarea
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                placeholder="What's happening, ETA, what staff should do…"
                className="mt-1 min-h-[120px]"
                disabled={submitting}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground">Status</label>
              <Select
                value={draftStatus}
                onValueChange={(v) => setDraftStatus(v as UpdateStatus)}
                disabled={submitting}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ongoing">Ongoing</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={submitting} className="gap-2">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Post update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StaffUpdates;
