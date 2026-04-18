import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  deleteDoc,
  doc,
  writeBatch,
  getDocs,
} from "firebase/firestore";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";
import {
  Shield,
  LogIn,
  Bell,
  UserPlus,
  UserMinus,
  Pencil,
  Trash2,
  Plus,
  Check,
  AlertCircle,
  MessageSquare,
  Phone,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Download,
  Clock,
  ArrowUpDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface LoginAttempt {
  id: string;
  email: string;
  success: boolean;
  timestamp: any;
  userAgent: string;
}

type NoteAction = "create" | "edit" | "delete" | "mark_read";
type NoteType = "message" | "call" | "alert";

interface NoteAuditRow {
  id: string;
  action: NoteAction;
  type: NoteType;
  title: string;
  description?: string;
  actor: string;
  timestamp: any;
}

interface PeopleAuditRow {
  id: string;
  /** Lifecycle event. Legacy rows without `action` are treated as "create". */
  action?: "create" | "remove" | "role_change";
  personId: string;
  name: string;
  email?: string;
  phone?: string;
  /** For "create": "manual" | "invite". For "role_change": "agent→admin" etc. */
  source?: string;
  fromRole?: "agent" | "admin" | "webmaster";
  toRole?: "agent" | "admin" | "webmaster";
  actor: string;
  timestamp: any;
}

const PAGE_SIZE = 10;

const noteActionMeta: Record<
  NoteAction,
  { label: string; icon: React.ReactNode; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  create: { label: "Created", icon: <Plus className="h-3 w-3" />, variant: "default" },
  edit: { label: "Edited", icon: <Pencil className="h-3 w-3" />, variant: "secondary" },
  delete: { label: "Deleted", icon: <Trash2 className="h-3 w-3" />, variant: "destructive" },
  mark_read: { label: "Marked read", icon: <Check className="h-3 w-3" />, variant: "outline" },
};

const noteTypeIcon: Record<NoteType, React.ReactNode> = {
  message: <MessageSquare className="h-3.5 w-3.5" />,
  call: <Phone className="h-3.5 w-3.5" />,
  alert: <AlertCircle className="h-3.5 w-3.5" />,
};

function formatTs(ts: any): string {
  return ts?.toDate?.() ? ts.toDate().toLocaleString() : "—";
}

/**
 * Escape a single CSV field per RFC 4180: wrap in quotes when the value
 * contains a comma, quote, newline, or carriage return; double any internal
 * quotes. Null/undefined become an empty cell.
 */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Build a CSV string from headers + row arrays and trigger a browser download.
 * Filename gets a YYYY-MM-DD suffix so successive exports don't overwrite.
 */
function downloadCsv(filenameBase: string, headers: string[], rows: (string | number | undefined | null)[][]) {
  const csv = [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\r\n");
  const today = new Date().toISOString().slice(0, 10);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameBase}-${today}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Single export trigger. Disabled when there's nothing to export so the user
 * doesn't get an empty file.
 */
const ExportCsvButton: React.FC<{ label: string; count: number; onExport: () => void }> = ({
  label,
  count,
  onExport,
}) => (
  <Button
    variant="outline"
    size="sm"
    className="gap-1.5"
    disabled={count === 0}
    onClick={onExport}
    aria-label={`Export ${label} as CSV`}
  >
    <Download className="h-3.5 w-3.5" />
    <span className="hidden sm:inline">Export CSV</span>
    <span className="sm:hidden">CSV</span>
    {count > 0 && <span className="text-[10px] opacity-70">({count})</span>}
  </Button>
);

/**
 * Tiny pagination control. Keeps state local — caller controls slicing.
 */
const Pagination: React.FC<{
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  totalLabel?: string;
}> = ({ page, pageCount, onChange, totalLabel }) => {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 border-t border-border bg-muted/20">
      <p className="text-xs text-muted-foreground">
        Page {page} of {pageCount}
        {totalLabel ? ` · ${totalLabel}` : ""}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 px-2"
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Prev</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 px-2"
          onClick={() => onChange(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};

/**
 * Reusable confirm-and-delete trigger for any audit row.
 */
const RowDeleteButton: React.FC<{ label: string; onConfirm: () => Promise<void> | void }> = ({
  label,
  onConfirm,
}) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        aria-label={`Delete ${label}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete this audit entry?</AlertDialogTitle>
        <AlertDialogDescription>
          This permanently removes the entry from the audit log. This action cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          onClick={onConfirm}
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

const AuditLogs: React.FC = () => {
  const [loginAttempts, setLoginAttempts] = useState<LoginAttempt[]>([]);
  const [loadingLogins, setLoadingLogins] = useState(true);
  const [loginPage, setLoginPage] = useState(1);

  const [notes, setNotes] = useState<NoteAuditRow[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [notePage, setNotePage] = useState(1);

  const [people, setPeople] = useState<PeopleAuditRow[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(true);
  const [peoplePage, setPeoplePage] = useState(1);

  useEffect(() => {
    const q = query(collection(db, "login_attempts"), orderBy("timestamp", "desc"), limit(200));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        setLoginAttempts(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as LoginAttempt)));
        setLoadingLogins(false);
      },
      (error) => {
        console.error("Failed to listen to login attempts:", error);
        setLoadingLogins(false);
      }
    );
    return unsub;
  }, []);

  useEffect(() => {
    const q = query(collection(db, "noteAudit"), orderBy("timestamp", "desc"), limit(200));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        setNotes(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as NoteAuditRow)));
        setLoadingNotes(false);
      },
      (error) => {
        console.error("Failed to listen to noteAudit:", error);
        setLoadingNotes(false);
      }
    );
    return unsub;
  }, []);

  useEffect(() => {
    const q = query(collection(db, "peopleAudit"), orderBy("timestamp", "desc"), limit(200));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        setPeople(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as PeopleAuditRow)));
        setLoadingPeople(false);
      },
      (error) => {
        console.error("Failed to listen to peopleAudit:", error);
        setLoadingPeople(false);
      }
    );
    return unsub;
  }, []);

  // ---------- Pagination slices ----------
  const loginPageCount = Math.max(1, Math.ceil(loginAttempts.length / PAGE_SIZE));
  const notePageCount = Math.max(1, Math.ceil(notes.length / PAGE_SIZE));
  const peoplePageCount = Math.max(1, Math.ceil(people.length / PAGE_SIZE));

  // Clamp current page when underlying list shrinks (e.g. row deleted on last page).
  useEffect(() => {
    if (loginPage > loginPageCount) setLoginPage(loginPageCount);
  }, [loginPage, loginPageCount]);
  useEffect(() => {
    if (notePage > notePageCount) setNotePage(notePageCount);
  }, [notePage, notePageCount]);
  useEffect(() => {
    if (peoplePage > peoplePageCount) setPeoplePage(peoplePageCount);
  }, [peoplePage, peoplePageCount]);

  const visibleLogins = useMemo(
    () => loginAttempts.slice((loginPage - 1) * PAGE_SIZE, loginPage * PAGE_SIZE),
    [loginAttempts, loginPage]
  );
  const visibleNotes = useMemo(
    () => notes.slice((notePage - 1) * PAGE_SIZE, notePage * PAGE_SIZE),
    [notes, notePage]
  );
  const visiblePeople = useMemo(
    () => people.slice((peoplePage - 1) * PAGE_SIZE, peoplePage * PAGE_SIZE),
    [people, peoplePage]
  );

  // ---------- Delete handlers ----------
  const handleDelete = async (
    collectionName: "login_attempts" | "noteAudit" | "peopleAudit",
    id: string,
    label: string
  ) => {
    try {
      await deleteDoc(doc(db, collectionName, id));
      toast({ title: "Audit entry deleted", description: label });
    } catch (e: any) {
      console.error("Failed to delete audit entry:", e);
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  };

  /**
   * Wipe every document in an audit collection.
   *
   * Firestore writeBatch is capped at 500 operations, so we chunk through the
   * collection in 400-doc passes. We pull IDs via getDocs (one-shot read) rather
   * than relying on the live snapshot to avoid racing the listener.
   */
  const handleClearAll = async (
    collectionName: "login_attempts" | "noteAudit" | "peopleAudit",
    label: string
  ) => {
    try {
      const snap = await getDocs(collection(db, collectionName));
      if (snap.empty) {
        toast({ title: "Nothing to clear", description: `No ${label} entries.` });
        return;
      }
      const docs = snap.docs;
      const CHUNK = 400;
      for (let i = 0; i < docs.length; i += CHUNK) {
        const batch = writeBatch(db);
        docs.slice(i, i + CHUNK).forEach((d) => batch.delete(doc(db, collectionName, d.id)));
        await batch.commit();
      }
      toast({ title: `${label} cleared`, description: `${docs.length} entries permanently deleted.` });
    } catch (e: any) {
      console.error("Failed to clear collection:", e);
      toast({ title: "Clear failed", description: e?.message, variant: "destructive" });
    }
  };

  /**
   * Confirm-then-wipe trigger placed in the toolbar above each tab's table.
   * Disabled when the tab is empty so users get visual feedback.
   */
  const ClearAllButton: React.FC<{
    label: string;
    count: number;
    onConfirm: () => Promise<void> | void;
  }> = ({ label, count, onConfirm }) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
          disabled={count === 0}
          aria-label={`Clear all ${label}`}
        >
          <Eraser className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Clear all</span>
          <span className="sm:hidden">Clear</span>
          {count > 0 && <span className="text-[10px] opacity-70">({count})</span>}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear all {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes <strong>{count}</strong> {label} entries. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete all {count}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  /**
   * Webmaster-only retention purge: deletes login_attempts older than 90 days
   * via the `purgeOldLoginAttempts` Cloud Function so the audit log can't be
   * inflated indefinitely. The Cloud Function enforces the webmaster role
   * server-side; the AuditLogs page itself is also webmaster-gated upstream.
   */
  const PurgeOldButton: React.FC = () => {
    const [purging, setPurging] = useState(false);
    const handlePurge = async () => {
      setPurging(true);
      try {
        const fn = httpsCallable<
          { olderThanDays: number },
          { ok: boolean; deleted: number; days: number }
        >(functions, "purgeOldLoginAttempts");
        const res = await fn({ olderThanDays: 90 });
        toast({
          title: "Old login attempts purged",
          description: `${res.data.deleted} record${res.data.deleted === 1 ? "" : "s"} older than ${res.data.days} days deleted.`,
        });
      } catch (e: any) {
        toast({
          title: "Purge failed",
          description: e?.message ?? "Could not purge old records.",
          variant: "destructive",
        });
      } finally {
        setPurging(false);
      }
    };
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={purging}
            aria-label="Purge login attempts older than 90 days"
          >
            <Clock className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{purging ? "Purging…" : "Purge >90d"}</span>
            <span className="sm:hidden">90d</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Purge login attempts older than 90 days?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently deletes every login attempt with a timestamp more than 90 days ago.
              This protects the audit log from unbounded growth and is the recommended
              retention window. Recent records are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePurge}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Purge old records
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  };

  // ---------- 14-day login attempts bar chart ----------
  /**
   * Bucket login attempts into the last 14 daily buckets (oldest → newest).
   * Each bucket counts both success + failed attempts so admins can spot spikes.
   * Recomputed via useMemo whenever the login attempts list changes.
   */
  const loginChart = useMemo(() => {
    const days: { key: string; label: string; date: Date; success: number; failed: number }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      days.push({
        key: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        date: d,
        success: 0,
        failed: 0,
      });
    }
    const indexByKey = new Map(days.map((d, i) => [d.key, i]));
    for (const a of loginAttempts) {
      const ts: Date | undefined = a.timestamp?.toDate?.();
      if (!ts) continue;
      const key = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate()).toISOString().slice(0, 10);
      const idx = indexByKey.get(key);
      if (idx === undefined) continue;
      if (a.success) days[idx].success += 1;
      else days[idx].failed += 1;
    }
    const max = Math.max(1, ...days.map((d) => d.success + d.failed));
    const total = days.reduce((acc, d) => acc + d.success + d.failed, 0);
    return { days, max, total };
  }, [loginAttempts]);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 md:mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Shield className="h-7 w-7 text-primary" />
            Audit Logs
          </h1>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">
            Real-time security and activity events. Notification edits and new agents are tracked as they happen.
          </p>
        </div>
      </div>

      <Tabs defaultValue="logins" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="logins" className="gap-2">
            <LogIn className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Login Attempts</span>
            <span className="sm:hidden">Logins</span>
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-2">
            <Bell className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Notification Changes</span>
            <span className="sm:hidden">Notes</span>
          </TabsTrigger>
          <TabsTrigger value="people" className="gap-2">
            <UserPlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Agent Activity</span>
            <span className="sm:hidden">Agents</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="logins">
          {/* 14-day login attempts bar chart */}
          <div className="rounded-xl border border-border bg-card p-4 md:p-5 mb-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Login attempts · last 14 days</h2>
                <p className="text-xs text-muted-foreground">
                  {loginChart.total} attempt{loginChart.total === 1 ? "" : "s"} in this window
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-primary" /> Success
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-destructive" /> Failed
                </span>
              </div>
            </div>
            <div className="flex items-end gap-1.5 h-24" role="img" aria-label="Login attempts per day for the last 14 days">
              {loginChart.days.map((d) => {
                const total = d.success + d.failed;
                const heightPct = (total / loginChart.max) * 100;
                const successPct = total > 0 ? (d.success / total) * 100 : 0;
                return (
                  <div key={d.key} className="flex-1 flex flex-col items-center gap-1 group">
                    <div
                      className="w-full rounded-t-sm overflow-hidden bg-muted/40 flex flex-col-reverse transition-opacity hover:opacity-80"
                      style={{ height: `${Math.max(2, heightPct)}%`, minHeight: total > 0 ? 4 : 2 }}
                      title={`${d.label}: ${d.success} success, ${d.failed} failed`}
                    >
                      {total > 0 && (
                        <>
                          <div className="bg-primary w-full" style={{ height: `${successPct}%` }} />
                          <div className="bg-destructive w-full" style={{ height: `${100 - successPct}%` }} />
                        </>
                      )}
                    </div>
                    <span className="text-[9px] text-muted-foreground tabular-nums hidden sm:block">
                      {d.label.split(" ")[1]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 mb-3 flex-wrap">
            <ExportCsvButton
              label="login attempts"
              count={loginAttempts.length}
              onExport={() =>
                downloadCsv(
                  "login-attempts",
                  ["Email", "Status", "Timestamp", "UID", "User Agent"],
                  loginAttempts.map((a) => [
                    a.email,
                    a.success ? "Success" : "Failed",
                    a.timestamp?.toDate?.()?.toISOString() ?? "",
                    (a as any).uid ?? "",
                    a.userAgent ?? "",
                  ])
                )
              }
            />
            <PurgeOldButton />
            <ClearAllButton
              label="login attempts"
              count={loginAttempts.length}
              onConfirm={() => handleClearAll("login_attempts", "login attempts")}
            />
          </div>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Email</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Timestamp</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">User Agent</th>
                    <th className="px-4 md:px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingLogins ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Loading...</td>
                    </tr>
                  ) : visibleLogins.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">No login attempts recorded yet</td>
                    </tr>
                  ) : (
                    visibleLogins.map((attempt, i) => (
                      <motion.tr
                        key={attempt.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.02 }}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 md:px-6 py-3 text-sm text-foreground">{attempt.email}</td>
                        <td className="px-4 md:px-6 py-3">
                          <Badge variant={attempt.success ? "default" : "destructive"} className="text-xs">
                            {attempt.success ? "Success" : "Failed"}
                          </Badge>
                        </td>
                        <td className="px-4 md:px-6 py-3 text-sm text-muted-foreground">{formatTs(attempt.timestamp)}</td>
                        <td className="px-4 md:px-6 py-3 text-xs text-muted-foreground max-w-xs truncate">{attempt.userAgent || "—"}</td>
                        <td className="px-4 md:px-6 py-3 text-right">
                          <RowDeleteButton
                            label={`login attempt for ${attempt.email}`}
                            onConfirm={() => handleDelete("login_attempts", attempt.id, attempt.email)}
                          />
                        </td>
                      </motion.tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={loginPage}
              pageCount={loginPageCount}
              onChange={setLoginPage}
              totalLabel={`${loginAttempts.length} entries`}
            />
          </div>
        </TabsContent>

        <TabsContent value="notes">
          <div className="flex items-center justify-end gap-2 mb-3">
            <ExportCsvButton
              label="notification changes"
              count={notes.length}
              onExport={() =>
                downloadCsv(
                  "notification-changes",
                  ["Action", "Type", "Title", "Description", "Actor", "Timestamp"],
                  notes.map((n) => [
                    n.action,
                    n.type,
                    n.title,
                    n.description ?? "",
                    n.actor,
                    n.timestamp?.toDate?.()?.toISOString() ?? "",
                  ])
                )
              }
            />
            <ClearAllButton
              label="notification changes"
              count={notes.length}
              onConfirm={() => handleClearAll("noteAudit", "notification changes")}
            />
          </div>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Action</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Type</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Title</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Actor</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">When</th>
                    <th className="px-4 md:px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingNotes ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">Loading...</td>
                    </tr>
                  ) : visibleNotes.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                        No notification activity yet. Add or edit a note on the Notifications page to see entries here.
                      </td>
                    </tr>
                  ) : (
                    visibleNotes.map((n, i) => {
                      const meta = noteActionMeta[n.action] || noteActionMeta.create;
                      return (
                        <motion.tr
                          key={n.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.02 }}
                          className="border-b border-border last:border-0"
                        >
                          <td className="px-4 md:px-6 py-3">
                            <Badge variant={meta.variant} className="gap-1 text-xs">
                              {meta.icon}
                              {meta.label}
                            </Badge>
                          </td>
                          <td className="px-4 md:px-6 py-3">
                            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                              {noteTypeIcon[n.type] || <Bell className="h-3.5 w-3.5" />}
                              <span className="capitalize">{n.type}</span>
                            </span>
                          </td>
                          <td className="px-4 md:px-6 py-3">
                            <p className="text-sm text-foreground">{n.title}</p>
                            {n.description && <p className="text-xs text-muted-foreground line-clamp-1">{n.description}</p>}
                          </td>
                          <td className="px-4 md:px-6 py-3 text-sm text-muted-foreground">{n.actor}</td>
                          <td className="px-4 md:px-6 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatTs(n.timestamp)}</td>
                          <td className="px-4 md:px-6 py-3 text-right">
                            <RowDeleteButton
                              label={n.title || "note audit entry"}
                              onConfirm={() => handleDelete("noteAudit", n.id, n.title)}
                            />
                          </td>
                        </motion.tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={notePage}
              pageCount={notePageCount}
              onChange={setNotePage}
              totalLabel={`${notes.length} entries`}
            />
          </div>
        </TabsContent>

        <TabsContent value="people">
          <div className="flex items-center justify-end gap-2 mb-3">
            <ExportCsvButton
              label="agent activity"
              count={people.length}
              onExport={() =>
                downloadCsv(
                  "agent-activity",
                  ["Action", "Name", "Email", "Source / Transition", "Agent ID", "Actor", "Timestamp"],
                  people.map((p) => [
                    p.action ?? "create",
                    p.name,
                    p.email ?? "",
                    p.source ?? "manual",
                    p.personId,
                    p.actor,
                    p.timestamp?.toDate?.()?.toISOString() ?? "",
                  ])
                )
              }
            />
            <ClearAllButton
              label="agent activity"
              count={people.length}
              onConfirm={() => handleClearAll("peopleAudit", "agent activity")}
            />
          </div>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Action</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Agent</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Email</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Detail</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">By</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">When</th>
                    <th className="px-4 md:px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingPeople ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">Loading...</td>
                    </tr>
                  ) : visiblePeople.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">
                        No agent activity yet. Add, invite, remove, or change a role on the Agents page and entries will appear here.
                      </td>
                    </tr>
                  ) : (
                    visiblePeople.map((p, i) => {
                      // Legacy rows (pre-action field) are creations.
                      const action = p.action ?? "create";
                      const actionMeta: { label: string; icon: React.ReactNode; variant: "default" | "secondary" | "destructive" | "outline" } =
                        action === "remove"
                          ? { label: "Removed", icon: <UserMinus className="h-3 w-3" />, variant: "destructive" }
                          : action === "role_change"
                          ? { label: "Role changed", icon: <ArrowUpDown className="h-3 w-3" />, variant: "secondary" }
                          : { label: "Created", icon: <UserPlus className="h-3 w-3" />, variant: "default" };
                      // Detail column: source for create/remove, transition arrow for role_change.
                      const detail = action === "role_change"
                        ? `${p.fromRole ?? "?"} → ${p.toRole ?? "?"}`
                        : (p.source ?? "manual");
                      return (
                        <motion.tr
                          key={p.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.02 }}
                          className="border-b border-border last:border-0"
                        >
                          <td className="px-4 md:px-6 py-3">
                            <Badge variant={actionMeta.variant} className="gap-1 text-xs">
                              {actionMeta.icon}
                              {actionMeta.label}
                            </Badge>
                          </td>
                          <td className="px-4 md:px-6 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                                {(p.name || "?").charAt(0)}
                              </div>
                              <span className="text-sm font-medium text-foreground">{p.name || "—"}</span>
                            </div>
                          </td>
                          <td className="px-4 md:px-6 py-3 text-sm text-muted-foreground">{p.email || "—"}</td>
                          <td className="px-4 md:px-6 py-3">
                            <Badge variant="outline" className="text-xs capitalize font-mono">
                              {detail}
                            </Badge>
                          </td>
                          <td className="px-4 md:px-6 py-3 text-sm text-muted-foreground">{p.actor}</td>
                          <td className="px-4 md:px-6 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatTs(p.timestamp)}</td>
                          <td className="px-4 md:px-6 py-3 text-right">
                            <RowDeleteButton
                              label={`${p.name || "agent"} audit entry`}
                              onConfirm={() => handleDelete("peopleAudit", p.id, p.name)}
                            />
                          </td>
                        </motion.tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={peoplePage}
              pageCount={peoplePageCount}
              onChange={setPeoplePage}
              totalLabel={`${people.length} entries`}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AuditLogs;
