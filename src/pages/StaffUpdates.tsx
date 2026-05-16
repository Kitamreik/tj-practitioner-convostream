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
  ShieldAlert,
  Mail,
  Filter,
  X,
  CalendarIcon,
  ClipboardList,
} from "lucide-react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import SupportEmailDialog from "@/components/SupportEmailDialog";
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
import FlaggedTermsManager from "@/components/FlaggedTermsManager";

/**
 * Staff Updates — webmaster-authored announcements for the team. Everyone
 * (agents/admins/webmasters) can read; only webmasters can create, change
 * status, or delete. Status tags: ongoing, maintenance, resolved.
 *
 * Firestore path: `staff_updates/{id}` — see firestore.rules for write gating.
 */

type UpdateStatus = "ongoing" | "maintenance" | "resolved";
export type FlagReviewStatus = "open" | "in_review" | "resolved";

interface StaffUpdate {
  id: string;
  title: string;
  body: string;
  status: UpdateStatus;
  createdAt?: any;
  authorUid: string;
  authorName: string;
  kind?: "announcement" | "flag_alert";
  screenshotDataUrl?: string | null;
  matches?: string[];
  context?: string;
  conversationId?: string | null;
  threadId?: string | null;
  // flag_alert review tracking
  reviewStatus?: FlagReviewStatus;
  resolutionNotes?: string;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: any;
}

const REVIEW_META: Record<FlagReviewStatus, { label: string; className: string }> = {
  open: {
    label: "Open",
    className: "bg-destructive/10 text-destructive border-destructive/30",
  },
  in_review: {
    label: "In review",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  },
  resolved: {
    label: "Resolved",
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  },
};

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

  // Filters
  const [kindFilter, setKindFilter] = useState<"all" | "flag_alert" | "announcement">("all");
  const [termFilter, setTermFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  // Per-card review-notes drafts (local to the card UI).
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  // Per-card email-support dialog state.
  const [emailFor, setEmailFor] = useState<StaffUpdate | null>(null);

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

  // Available matched-term options derived from existing flag_alert docs.
  const termOptions = useMemo(() => {
    const set = new Set<string>();
    updates.forEach((u) => {
      if (u.kind === "flag_alert" && Array.isArray(u.matches)) {
        u.matches.forEach((m) => set.add(String(m).toLowerCase()));
      }
    });
    return Array.from(set).sort();
  }, [updates]);

  const filtered = useMemo(() => {
    return updates.filter((u) => {
      const kindNorm = u.kind === "flag_alert" ? "flag_alert" : "announcement";
      if (kindFilter !== "all" && kindNorm !== kindFilter) return false;
      if (termFilter !== "all") {
        const matches = Array.isArray(u.matches) ? u.matches.map((m) => String(m).toLowerCase()) : [];
        if (!matches.includes(termFilter)) return false;
      }
      if (dateFrom || dateTo) {
        const ts: Date | null = u.createdAt?.toDate ? u.createdAt.toDate() : null;
        if (!ts) return false;
        if (dateFrom && ts < dateFrom) return false;
        if (dateTo) {
          const end = new Date(dateTo);
          end.setHours(23, 59, 59, 999);
          if (ts > end) return false;
        }
      }
      return true;
    });
  }, [updates, kindFilter, termFilter, dateFrom, dateTo]);

  const grouped = useMemo(() => {
    const active = filtered.filter((u) => u.status !== "resolved");
    const resolved = filtered.filter((u) => u.status === "resolved");
    return { active, resolved };
  }, [filtered]);

  const hasActiveFilters =
    kindFilter !== "all" || termFilter !== "all" || !!dateFrom || !!dateTo;
  const clearFilters = () => {
    setKindFilter("all");
    setTermFilter("all");
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  const handleReviewStatus = async (u: StaffUpdate, next: FlagReviewStatus) => {
    if (!profile) return;
    setReviewBusy(u.id);
    try {
      await updateDoc(doc(db, "staff_updates", u.id), {
        reviewStatus: next,
        reviewedBy: profile.uid,
        reviewedByName: profile.displayName || profile.email || "Agent",
        reviewedAt: serverTimestamp(),
      });
    } catch (e: any) {
      toast({ title: "Couldn't update review", description: e?.message, variant: "destructive" });
    } finally {
      setReviewBusy(null);
    }
  };

  const handleSaveNotes = async (u: StaffUpdate) => {
    if (!profile) return;
    const notes = (notesDraft[u.id] ?? u.resolutionNotes ?? "").trim();
    setReviewBusy(u.id);
    try {
      await updateDoc(doc(db, "staff_updates", u.id), {
        resolutionNotes: notes,
        reviewedBy: profile.uid,
        reviewedByName: profile.displayName || profile.email || "Agent",
        reviewedAt: serverTimestamp(),
      });
      toast({ title: "Notes saved" });
    } catch (e: any) {
      toast({ title: "Couldn't save notes", description: e?.message, variant: "destructive" });
    } finally {
      setReviewBusy(null);
    }
  };

  // Build mailto prefill payload for a flag_alert.
  const buildEmailDraft = (u: StaffUpdate) => {
    const subject = `Escalation review: ${u.title}`;
    const ctxLines = [
      `Hi ConvoHub support,`,
      ``,
      `Forwarding a flagged communication for review.`,
      ``,
      `Author: ${u.authorName}`,
      `Posted: ${u.createdAt?.toDate ? u.createdAt.toDate().toLocaleString() : "unknown"}`,
      `Context: ${u.context || "n/a"}`,
      `Matched terms: ${(u.matches || []).join(", ") || "n/a"}`,
      u.conversationId ? `Conversation ID: ${u.conversationId}` : "",
      u.threadId ? `Thread ID: ${u.threadId}` : "",
      ``,
      `Original alert body:`,
      u.body || "(empty)",
      ``,
      `Reviewer notes:`,
      (u.resolutionNotes || "").trim() || "(none yet)",
      ``,
      `Please advise on next steps.`,
    ].filter(Boolean);
    return { subject, body: ctxLines.join("\n") };
  };

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
        {u.kind === "flag_alert" && u.matches && u.matches.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {u.matches.map((m) => (
              <Badge key={m} variant="destructive" className="text-[10px]">
                {m}
              </Badge>
            ))}
          </div>
        )}
        {u.kind === "flag_alert" && u.screenshotDataUrl && (
          <a
            href={u.screenshotDataUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 block overflow-hidden rounded-lg border border-border"
          >
            <img
              src={u.screenshotDataUrl}
              alt="Screenshot of flagged communication"
              className="w-full"
            />
          </a>
        )}
        {u.kind === "flag_alert" && (() => {
          const review = (u.reviewStatus ?? "open") as FlagReviewStatus;
          const meta = REVIEW_META[review];
          const draft = notesDraft[u.id] ?? u.resolutionNotes ?? "";
          return (
            <div className="mt-4 rounded-lg border border-border bg-background/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-foreground">Review</span>
                  <Badge variant="outline" className={`text-[10px] ${meta.className}`}>
                    {meta.label}
                  </Badge>
                  {u.reviewedByName && (
                    <span className="text-[10px] text-muted-foreground">
                      by {u.reviewedByName}
                      {u.reviewedAt?.toDate ? ` · ${formatRelative(u.reviewedAt)}` : ""}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Select
                    value={review}
                    onValueChange={(v) => handleReviewStatus(u, v as FlagReviewStatus)}
                    disabled={reviewBusy === u.id}
                  >
                    <SelectTrigger className="h-7 w-[120px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_review">In review</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => setEmailFor(u)}
                  >
                    <Mail className="h-3 w-3" /> Email support
                  </Button>
                </div>
              </div>
              <Textarea
                value={draft}
                onChange={(e) =>
                  setNotesDraft((prev) => ({ ...prev, [u.id]: e.target.value }))
                }
                placeholder="Resolution notes — what action did you take?"
                className="min-h-[60px] text-xs"
                disabled={reviewBusy === u.id}
              />
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => handleSaveNotes(u)}
                  disabled={reviewBusy === u.id || draft === (u.resolutionNotes ?? "")}
                >
                  {reviewBusy === u.id && <Loader2 className="h-3 w-3 animate-spin" />}
                  Save notes
                </Button>
              </div>
            </div>
          );
        })()}
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

      {isWebmaster && (
        <div className="mb-6">
          <FlaggedTermsManager />
        </div>
      )}

      <div className="mb-4 rounded-lg border border-border bg-card/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as any)}>
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue placeholder="Kind" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              <SelectItem value="announcement">Announcements</SelectItem>
              <SelectItem value="flag_alert">Flag alerts</SelectItem>
            </SelectContent>
          </Select>
          <Select value={termFilter} onValueChange={setTermFilter}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="Matched term" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All terms</SelectItem>
              {termOptions.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("h-8 gap-1.5 text-xs", !dateFrom && "text-muted-foreground")}>
                <CalendarIcon className="h-3.5 w-3.5" />
                {dateFrom ? format(dateFrom, "MMM d") : "From"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("h-8 gap-1.5 text-xs", !dateTo && "text-muted-foreground")}>
                <CalendarIcon className="h-3.5 w-3.5" />
                {dateTo ? format(dateTo, "MMM d") : "To"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{filtered.length}</span> of {updates.length}
            </span>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={clearFilters}>
                <X className="h-3.5 w-3.5" /> Clear
              </Button>
            )}
          </div>
        </div>
      </div>

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
