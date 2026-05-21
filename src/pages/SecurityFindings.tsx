import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  EyeOff,
  RefreshCw,
  Download,
  ChevronDown,
  Lock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import SecurityReauthDialog from "@/components/SecurityReauthDialog";
import {
  FindingStatus,
  SEVERITY_LABEL,
  STATUS_LABEL,
  SecurityAlert,
  SecurityFinding,
  Severity,
  fmtTs,
  seedDefaultFindings,
  stampRescan,
  subscribeAlerts,
  subscribeFindings,
  updateFindingStatus,
} from "@/lib/securityFindings";

const REDACTED = "••••••••";
const LOCKOUT_MS = 15 * 60 * 1000;
const UNLOCK_KEY = "convohub.security.unlocked";
const LOCKOUT_KEY = "convohub.security.lockoutUntil";



interface LoginAttemptRow {
  id: string;
  email: string;
  success: boolean;
  timestamp: { toMillis?: () => number } | null;
  userAgent?: string;
}

/** CSV-safe value — wraps in quotes and escapes embedded quotes. */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/\r?\n/g, " ").replace(/"/g, '""');
  return `"${s}"`;
}

function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const body = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const severityColor: Record<Severity, string> = {
  info: "bg-muted text-muted-foreground",
  warn: "bg-warning/15 text-warning border-warning/30",
  error: "bg-destructive/15 text-destructive border-destructive/30",
};

const statusColor: Record<FindingStatus, string> = {
  open: "bg-destructive/15 text-destructive border-destructive/30",
  in_review: "bg-warning/15 text-warning border-warning/30",
  fixed: "bg-success/15 text-success border-success/30",
  ignored: "bg-muted text-muted-foreground",
};

/**
 * Webmaster-only security dashboard.
 *
 * Three lenses:
 *   1. Findings — known security issues with severity, affected collections,
 *      status, and the last re-scan timestamp.
 *   2. Alerts — runtime suspicious-activity stream (privilege-flag write
 *      attempts emitted by `enforceUserRoleOnWrite`, plus derived
 *      failed-login streaks from `login_attempts`).
 *   3. CSV exports for the Audit team.
 */
const SecurityFindings: React.FC = () => {
  const { profile } = useAuth();
  const [findings, setFindings] = useState<SecurityFinding[]>([]);
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [logins, setLogins] = useState<LoginAttemptRow[]>([]);
  const [rescanning, setRescanning] = useState(false);
  const [editing, setEditing] = useState<Record<string, { status: FindingStatus; notes: string }>>({});

  // ---- Password gate: sensitive details are masked until the webmaster
  // re-enters their account password. State is per-tab (sessionStorage) so
  // closing the tab re-locks. Three wrong attempts trigger a 15-minute
  // panel lockout (also persisted in sessionStorage so a page reload
  // can't shortcut it).
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    if (typeof sessionStorage === "undefined") return false;
    return sessionStorage.getItem(UNLOCK_KEY) === "1";
  });
  const [reauthOpen, setReauthOpen] = useState(false);
  const [failCount, setFailCount] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number>(() => {
    if (typeof sessionStorage === "undefined") return 0;
    const raw = sessionStorage.getItem(LOCKOUT_KEY);
    return raw ? Number(raw) || 0 : 0;
  });
  const lockedOut = lockoutUntil > Date.now();
  const locked = !unlocked;

  // Re-evaluate lockout every 30s so the UI re-enables once the window passes.
  useEffect(() => {
    if (!lockedOut) return;
    const t = setInterval(() => {
      if (Date.now() >= lockoutUntil) {
        setLockoutUntil(0);
        try { sessionStorage.removeItem(LOCKOUT_KEY); } catch { /* noop */ }
      }
    }, 30_000);
    return () => clearInterval(t);
  }, [lockedOut, lockoutUntil]);

  const handleUnlockSuccess = () => {
    setUnlocked(true);
    try { sessionStorage.setItem(UNLOCK_KEY, "1"); } catch { /* noop */ }
    toast({ title: "Security findings unlocked", description: "Sensitive details visible for this session." });
  };

  const handleLockoutTriggered = () => {
    const until = Date.now() + LOCKOUT_MS;
    setLockoutUntil(until);
    setFailCount(0);
    try { sessionStorage.setItem(LOCKOUT_KEY, String(until)); } catch { /* noop */ }
  };

  const handleLock = () => {
    setUnlocked(false);
    try { sessionStorage.removeItem(UNLOCK_KEY); } catch { /* noop */ }
  };


  // One-time seed of default findings so the dashboard isn't empty.
  useEffect(() => {
    if (profile?.role !== "webmaster") return;
    seedDefaultFindings().catch((e) =>
      console.warn("seedDefaultFindings failed:", e)
    );
  }, [profile?.role]);

  useEffect(() => subscribeFindings(setFindings), []);
  useEffect(() => subscribeAlerts(setAlerts), []);

  // Listen to recent login attempts so we can derive failed-login-streak
  // alerts client-side (no server function required).
  useEffect(() => {
    const q = query(
      collection(db, "login_attempts"),
      orderBy("timestamp", "desc"),
      limit(500)
    );
    return onSnapshot(
      q,
      (snap) =>
        setLogins(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LoginAttemptRow, "id">) }))
        ),
      (err) => console.warn("login_attempts subscribe failed:", err)
    );
  }, []);

  /**
   * Derive a "failed login streak" alert for any email with ≥3 failed
   * attempts inside any rolling 10-minute window in the last 500 records.
   */
  const derivedLoginAlerts = useMemo(() => {
    const WINDOW_MS = 10 * 60 * 1000;
    const STREAK = 3;
    const byEmail = new Map<string, LoginAttemptRow[]>();
    for (const a of logins) {
      if (a.success) continue;
      const e = (a.email || "").toLowerCase();
      if (!e) continue;
      if (!byEmail.has(e)) byEmail.set(e, []);
      byEmail.get(e)!.push(a);
    }
    const out: SecurityAlert[] = [];
    for (const [email, list] of byEmail) {
      // list is already DESC by timestamp.
      const times = list
        .map((r) => r.timestamp?.toMillis?.() ?? 0)
        .filter((n) => n > 0)
        .sort((a, b) => b - a);
      // Sliding window: for each i, count how many entries are within WINDOW_MS.
      for (let i = 0; i < times.length; i++) {
        let n = 1;
        for (let j = i + 1; j < times.length; j++) {
          if (times[i] - times[j] <= WINDOW_MS) n++;
          else break;
        }
        if (n >= STREAK) {
          out.push({
            id: `derived-${email}-${times[i]}`,
            kind: "failed_login_streak",
            severity: "warn",
            summary: `${n} failed sign-ins for ${email} within 10 minutes`,
            subjectEmail: email,
            createdAt: { toMillis: () => times[i] } as never,
          });
          break;
        }
      }
    }
    return out;
  }, [logins]);

  const allAlerts = useMemo(() => {
    const merged = [...alerts, ...derivedLoginAlerts];
    merged.sort((a, b) => {
      const am = a.createdAt?.toMillis?.() ?? 0;
      const bm = b.createdAt?.toMillis?.() ?? 0;
      return bm - am;
    });
    return merged;
  }, [alerts, derivedLoginAlerts]);

  const openCount = findings.filter((f) => f.status === "open").length;
  const inReviewCount = findings.filter((f) => f.status === "in_review").length;
  const fixedCount = findings.filter((f) => f.status === "fixed").length;
  const lastScan = findings.reduce((acc, f) => {
    const m = f.lastScanAt?.toMillis?.() ?? 0;
    return m > acc ? m : acc;
  }, 0);

  const handleRescan = async () => {
    setRescanning(true);
    try {
      await stampRescan(findings);
      toast({ title: "Re-scan recorded", description: `Stamped ${findings.length} findings.` });
    } catch (e) {
      toast({
        title: "Re-scan failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setRescanning(false);
    }
  };

  const handleSave = async (f: SecurityFinding) => {
    const draft = editing[f.id];
    if (!draft) return;
    try {
      await updateFindingStatus(f.id, draft.status, draft.notes, profile?.uid ?? "");
      setEditing((prev) => {
        const next = { ...prev };
        delete next[f.id];
        return next;
      });
      toast({ title: "Finding updated", description: STATUS_LABEL[draft.status] });
    } catch (e) {
      toast({
        title: "Update failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  const exportFindingsCsv = () => {
    downloadCsv("security-findings.csv", [
      ["ID", "Title", "Severity", "Category", "Affected Collections", "Status", "Last Scan", "Fixed At", "Notes"],
      ...findings.map((f) => [
        f.id,
        f.title,
        SEVERITY_LABEL[f.severity],
        f.category,
        f.affectedCollections.join("; "),
        STATUS_LABEL[f.status],
        fmtTs(f.lastScanAt),
        fmtTs(f.fixedAt),
        f.notes ?? "",
      ]),
    ]);
  };

  const exportAlertsCsv = () => {
    downloadCsv("security-alerts.csv", [
      ["When", "Kind", "Severity", "Subject Email", "Subject UID", "Summary", "Detail (JSON)"],
      ...allAlerts.map((a) => [
        fmtTs(a.createdAt as never),
        a.kind,
        SEVERITY_LABEL[a.severity],
        a.subjectEmail ?? "",
        a.subjectUid ?? "",
        a.summary,
        a.detail ? JSON.stringify(a.detail) : "",
      ]),
    ]);
  };

  const exportLoginsCsv = () => {
    downloadCsv("login-attempts.csv", [
      ["When", "Email", "Outcome", "User Agent"],
      ...logins.map((l) => [
        l.timestamp?.toMillis?.() ? new Date(l.timestamp.toMillis()).toLocaleString() : "",
        l.email,
        l.success ? "success" : "failed",
        l.userAgent ?? "",
      ]),
    ]);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 space-y-6 max-w-6xl"
    >
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          <h1
            className="text-3xl font-bold text-foreground"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Security
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Known security findings, suspicious activity alerts, and audit log exports.
        </p>
      </header>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Open</CardDescription>
            <CardTitle className="text-3xl text-destructive">{openCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>In review</CardDescription>
            <CardTitle className="text-3xl text-warning">{inReviewCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Fixed</CardDescription>
            <CardTitle className="text-3xl text-success">{fixedCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Last re-scan</CardDescription>
            <CardTitle className="text-base font-medium">
              {lastScan ? new Date(lastScan).toLocaleString() : "Never"}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {locked ? (
          <Button
            onClick={() => setReauthOpen(true)}
            disabled={lockedOut}
            className="gap-2"
            variant="default"
          >
            <Lock className="h-4 w-4" />
            {lockedOut
              ? `Locked · retry in ${Math.max(
                  1,
                  Math.ceil((lockoutUntil - Date.now()) / 60_000)
                )}m`
              : "Unlock with password"}
          </Button>
        ) : (
          <Button onClick={handleLock} variant="outline" className="gap-2">
            <EyeOff className="h-4 w-4" /> Lock again
          </Button>
        )}
        <Button onClick={handleRescan} disabled={rescanning || findings.length === 0 || locked}>
          <RefreshCw className={`h-4 w-4 mr-2 ${rescanning ? "animate-spin" : ""}`} />
          Re-scan now
        </Button>
        <Button variant="outline" onClick={exportFindingsCsv} disabled={findings.length === 0 || locked}>
          <Download className="h-4 w-4 mr-2" /> Findings CSV
        </Button>
        <Button variant="outline" onClick={exportAlertsCsv} disabled={allAlerts.length === 0 || locked}>
          <Download className="h-4 w-4 mr-2" /> Alerts CSV
        </Button>
        <Button variant="outline" onClick={exportLoginsCsv} disabled={logins.length === 0 || locked}>
          <Download className="h-4 w-4 mr-2" /> Login attempts CSV
        </Button>
      </div>

      {locked && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-foreground flex items-start gap-2">
          <Lock className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Sensitive details are hidden.</p>
            <p className="text-muted-foreground">
              Finding descriptions, affected collections, review notes, alert
              subjects, and detail payloads are masked. Click
              <strong className="text-foreground"> Unlock with password </strong>
              and re-enter your account password to reveal them for this tab.
              Three wrong attempts will lock the panel for 15 minutes.
            </p>
          </div>
        </div>
      )}

      <Tabs defaultValue="findings">
        <TabsList>
          <TabsTrigger value="findings">Findings ({findings.length})</TabsTrigger>
          <TabsTrigger value="alerts">Alerts ({allAlerts.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="findings" className="space-y-3 mt-4">
          {findings.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No findings recorded yet. Run a scan from Lovable's security tools to populate this list.
              </CardContent>
            </Card>
          )}
          {findings.map((f) => {
            const draft = editing[f.id] ?? { status: f.status, notes: f.notes ?? "" };
            const isEditing = !!editing[f.id];
            return (
              <Card key={f.id}>
                <CardHeader className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="text-base flex-1 min-w-0">{f.title}</CardTitle>
                    <div className="flex gap-1.5 flex-wrap">
                      <Badge variant="outline" className={severityColor[f.severity]}>
                        {SEVERITY_LABEL[f.severity]}
                      </Badge>
                      <Badge variant="outline" className={statusColor[f.status]}>
                        {f.status === "fixed" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                        {f.status === "open" && <AlertTriangle className="h-3 w-3 mr-1" />}
                        {f.status === "ignored" && <EyeOff className="h-3 w-3 mr-1" />}
                        {STATUS_LABEL[f.status]}
                      </Badge>
                    </div>
                  </div>
                  <CardDescription>{locked ? REDACTED : f.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      <strong className="text-foreground">Category:</strong> {locked ? REDACTED : f.category}
                    </span>
                    <span>
                      <strong className="text-foreground">Collections:</strong>{" "}
                      {locked
                        ? REDACTED
                        : f.affectedCollections.length > 0
                        ? f.affectedCollections.join(", ")
                        : "—"}
                    </span>
                    <span>
                      <strong className="text-foreground">Last scan:</strong> {fmtTs(f.lastScanAt)}
                    </span>
                    {f.fixedAt && (
                      <span>
                        <strong className="text-foreground">Fixed:</strong> {fmtTs(f.fixedAt)}
                      </span>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-foreground">Status:</label>
                        <Select
                          value={draft.status}
                          onValueChange={(v) =>
                            setEditing((prev) => ({
                              ...prev,
                              [f.id]: { ...draft, status: v as FindingStatus },
                            }))
                          }
                        >
                          <SelectTrigger className="h-8 w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(["open", "in_review", "fixed", "ignored"] as FindingStatus[]).map((s) => (
                              <SelectItem key={s} value={s}>
                                {STATUS_LABEL[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Textarea
                        rows={2}
                        placeholder="Notes (what was changed, link to PR, who to follow up with…)"
                        value={draft.notes}
                        onChange={(e) =>
                          setEditing((prev) => ({
                            ...prev,
                            [f.id]: { ...draft, notes: e.target.value },
                          }))
                        }
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleSave(f)}>
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setEditing((prev) => {
                              const n = { ...prev };
                              delete n[f.id];
                              return n;
                            })
                          }
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      {f.notes ? (
                        <p className="text-xs text-muted-foreground italic flex-1">
                          “{locked ? REDACTED : f.notes}”
                        </p>
                      ) : (
                        <span className="text-xs text-muted-foreground">No review notes.</span>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={locked}
                        onClick={() =>
                          setEditing((prev) => ({
                            ...prev,
                            [f.id]: { status: f.status, notes: f.notes ?? "" },
                          }))
                        }
                      >
                        Update <ChevronDown className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="alerts" className="space-y-3 mt-4">
          {allAlerts.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No suspicious activity detected.
              </CardContent>
            </Card>
          )}
          {allAlerts.map((a) => (
            <Card key={a.id}>
              <CardHeader className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm">{locked ? REDACTED : a.summary}</CardTitle>
                  <Badge variant="outline" className={severityColor[a.severity]}>
                    {SEVERITY_LABEL[a.severity]}
                  </Badge>
                </div>
                <CardDescription className="text-xs">
                  {a.kind.replace(/_/g, " ")} · {fmtTs(a.createdAt as never)}
                  {a.subjectEmail && <> · {locked ? REDACTED : a.subjectEmail}</>}
                </CardDescription>
              </CardHeader>
              {a.detail && (
                <CardContent>
                  <pre className="text-[10px] bg-muted/40 rounded p-2 overflow-x-auto">
                    {locked ? REDACTED : JSON.stringify(a.detail, null, 2)}
                  </pre>
                </CardContent>
              )}
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      <SecurityReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        onSuccess={handleUnlockSuccess}
        onLockout={handleLockoutTriggered}
        failCount={failCount}
        setFailCount={setFailCount}
      />
    </motion.div>
  );
};

export default SecurityFindings;
