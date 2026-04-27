/**
 * Call Analytics — dashboards for call recordings + conversation outcomes.
 *
 * Metrics:
 *   - Volume: # recordings per day in the selected window.
 *   - Avg handle time: mean recording duration.
 *   - Avg wait time: time between conversation open (timestamp) and recording start.
 *   - Resolution rate: % of recordings whose conversation was resolved on the call.
 *
 * Filters: time window (7/30/90 days), agent (all / specific).
 *
 * Compliance helpers:
 *   - Storage usage estimate.
 *   - Quick "purge older than retention" link to Settings → Recordings.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  Clock,
  CheckCircle2,
  Mic,
  HardDrive,
  Filter,
  Download,
  ShieldCheck,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import {
  collection,
  getDocs,
  query as fsQuery,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import {
  listRecentRecordings,
  subscribeRetentionPolicy,
  deleteRecording,
  type CallRecordingDoc,
  type RetentionPolicy,
  DEFAULT_RETENTION,
} from "@/lib/callRecordings";
import RecordingPlayerDialog from "@/components/RecordingPlayerDialog";

type WindowDays = 7 | 30 | 90;

interface AgentOption {
  uid: string;
  name: string;
}

const CallAnalytics: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [recordings, setRecordings] = useState<CallRecordingDoc[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [policy, setPolicy] = useState<RetentionPolicy>(DEFAULT_RETENTION);
  const [playerRecording, setPlayerRecording] = useState<CallRecordingDoc | null>(null);
  const canViewAll = profile?.role === "admin" || profile?.role === "webmaster";

  useEffect(() => subscribeRetentionPolicy(setPolicy), []);

  // Load agents (for filter dropdown).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(collection(db, "users"));
        if (cancelled) return;
        const opts: AgentOption[] = snap.docs.map((d) => {
          const data = d.data() as { displayName?: string; email?: string };
          return { uid: d.id, name: data.displayName || data.email || d.id };
        });
        setAgents(opts.sort((a, b) => a.name.localeCompare(b.name)));
      } catch (e) {
        console.warn("Could not load agents:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load recordings whenever window or agent changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const sinceMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    listRecentRecordings({
      sinceMs,
      agentUid: canViewAll ? (agentFilter === "all" ? undefined : agentFilter) : profile?.uid,
      max: 1000,
    })
      .then((rows) => {
        if (cancelled) return;
        setRecordings(rows.filter((r) => !r.deletedAt));
      })
      .catch((e) => {
        console.warn("Failed to load recordings:", e);
        if (!cancelled) setRecordings([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [windowDays, agentFilter, canViewAll, profile?.uid]);

  // ---------- Aggregates ----------
  const stats = useMemo(() => {
    if (!recordings.length) {
      return {
        total: 0,
        avgHandleMs: 0,
        avgWaitMs: 0,
        resolutionRate: 0,
        totalBytes: 0,
      };
    }
    const total = recordings.length;
    const sumHandle = recordings.reduce((acc, r) => acc + (r.durationMs || 0), 0);
    const waitsKnown = recordings.filter((r) => typeof r.conversationStartedAt === "number");
    const sumWait = waitsKnown.reduce(
      (acc, r) => acc + Math.max(0, (r.startedAt || 0) - (r.conversationStartedAt || 0)),
      0
    );
    const resolved = recordings.filter((r) => r.resolvedOnCall === true).length;
    const totalBytes = recordings.reduce((acc, r) => acc + (r.sizeBytes || 0), 0);
    return {
      total,
      avgHandleMs: total ? sumHandle / total : 0,
      avgWaitMs: waitsKnown.length ? sumWait / waitsKnown.length : 0,
      resolutionRate: total ? (resolved / total) * 100 : 0,
      totalBytes,
    };
  }, [recordings]);

  const volumeByDay = useMemo(() => {
    const buckets = new Map<string, number>();
    const days: string[] = [];
    for (let i = windowDays - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      days.push(key);
      buckets.set(key, 0);
    }
    recordings.forEach((r) => {
      const key = new Date(r.startedAt).toISOString().slice(0, 10);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + 1);
    });
    return days.map((d) => ({
      day: d.slice(5), // MM-DD
      count: buckets.get(d) || 0,
    }));
  }, [recordings, windowDays]);

  const handleTimeByAgent = useMemo(() => {
    const map = new Map<string, { name: string; total: number; count: number }>();
    recordings.forEach((r) => {
      const cur = map.get(r.agentUid) || { name: r.agentName || "Unknown", total: 0, count: 0 };
      cur.total += r.durationMs || 0;
      cur.count += 1;
      map.set(r.agentUid, cur);
    });
    return Array.from(map.values())
      .map((v) => ({ name: v.name, avgMin: v.count ? v.total / v.count / 60000 : 0 }))
      .sort((a, b) => b.avgMin - a.avgMin)
      .slice(0, 10);
  }, [recordings]);

  const exportCsv = () => {
    const rows = [
      [
        "id",
        "conversationId",
        "agentName",
        "startedAt",
        "durationSec",
        "waitSec",
        "resolvedOnCall",
        "sizeBytes",
        "consentGiven",
      ],
      ...recordings.map((r) => [
        r.id,
        r.conversationId,
        r.agentName,
        new Date(r.startedAt).toISOString(),
        Math.round((r.durationMs || 0) / 1000).toString(),
        typeof r.conversationStartedAt === "number"
          ? Math.round(Math.max(0, r.startedAt - r.conversationStartedAt) / 1000).toString()
          : "",
        r.resolvedOnCall ? "true" : "false",
        (r.sizeBytes || 0).toString(),
        r.consentGiven ? "true" : "false",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `call-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onPurgeOne = async (rec: CallRecordingDoc) => {
    if (!window.confirm(`Delete recording from ${new Date(rec.startedAt).toLocaleString()}? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteRecording(rec);
      setRecordings((prev) => prev.filter((r) => r.id !== rec.id));
      toast({ title: "Recording deleted" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      toast({ title: "Could not delete", description: msg, variant: "destructive" });
    }
  };

  const onOpenRecording = (rec: CallRecordingDoc) => {
    setPlayerRecording(rec);
  };

  const canPurge = profile?.role === "admin" || profile?.role === "webmaster";

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" /> Call Analytics
          </h1>
          <p className="text-sm text-muted-foreground">
            Recording volume, handle time, wait time, and resolution outcomes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v) as WindowDays)}>
            <SelectTrigger className="w-[120px]">
              <Filter className="mr-1 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Select value={agentFilter} onValueChange={setAgentFilter} disabled={!canViewAll}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{canViewAll ? "All agents" : "My recordings"}</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.uid} value={a.uid}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!recordings.length}>
            <Download className="mr-1 h-4 w-4" /> Export CSV
          </Button>
        </div>
      </header>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={<Mic className="h-4 w-4" />}
          label="Recordings"
          value={loading ? null : stats.total.toLocaleString()}
          sub={`Last ${windowDays} days`}
        />
        <KpiCard
          icon={<Clock className="h-4 w-4" />}
          label="Avg handle time"
          value={loading ? null : formatDuration(stats.avgHandleMs)}
          sub="Per recorded call"
        />
        <KpiCard
          icon={<Clock className="h-4 w-4" />}
          label="Avg wait time"
          value={loading ? null : formatDuration(stats.avgWaitMs)}
          sub="Open → recording start"
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Resolved on call"
          value={loading ? null : `${stats.resolutionRate.toFixed(0)}%`}
          sub="Of recorded conversations"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Volume by day</CardTitle>
          </CardHeader>
          <CardContent className="h-[260px]">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={volumeByDay}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <RechartsTooltip
                    contentStyle={{
                      background: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Avg handle time per agent (top 10)</CardTitle>
          </CardHeader>
          <CardContent className="h-[260px]">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : handleTimeByAgent.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No recordings in window
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={handleTimeByAgent} layout="vertical" margin={{ left: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis type="number" tick={{ fontSize: 11 }} unit="m" />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
                  <RechartsTooltip
                    formatter={(v: number) => [`${v.toFixed(2)} min`, "Avg handle"]}
                    contentStyle={{
                      background: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="avgMin" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Storage + retention */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <HardDrive className="h-4 w-4" /> Storage & retention
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Total stored (window)</div>
              <div className="font-mono">{formatBytes(stats.totalBytes)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Retention policy</div>
              <div>
                {policy.retentionDays > 0
                  ? `Auto-delete after ${policy.retentionDays} day${policy.retentionDays === 1 ? "" : "s"}`
                  : "Keep indefinitely"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Consent gate</div>
              <div className="flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-success" />
                {policy.requireConsent ? "Required" : "Disabled"}
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/settings#call-recording-retention")}
          >
            <ExternalLink className="mr-1 h-4 w-4" /> Manage retention policy
          </Button>
        </CardContent>
      </Card>

      {/* Recent recordings table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent recordings</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : recordings.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No recordings in this window. Start one from a conversation header.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3">When</th>
                    <th className="py-2 pr-3">Agent</th>
                    <th className="py-2 pr-3">Duration</th>
                    <th className="py-2 pr-3">Wait</th>
                    <th className="py-2 pr-3">Resolved</th>
                    <th className="py-2 pr-3">Size</th>
                    <th className="py-2 pr-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recordings.slice(0, 50).map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-mono text-xs">
                        {new Date(r.startedAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3">{r.agentName}</td>
                      <td className="py-2 pr-3 font-mono">{formatDuration(r.durationMs)}</td>
                      <td className="py-2 pr-3 font-mono">
                        {typeof r.conversationStartedAt === "number"
                          ? formatDuration(Math.max(0, r.startedAt - r.conversationStartedAt))
                          : "—"}
                      </td>
                      <td className="py-2 pr-3">
                        {r.resolvedOnCall ? (
                          <Badge variant="default" className="text-[10px]">Yes</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">No</Badge>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{formatBytes(r.sizeBytes)}</td>
                      <td className="py-2 pr-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => onOpenRecording(r)}
                            aria-label="Play recording"
                            title="Play recording"
                          >
                            <Mic className="h-3.5 w-3.5" />
                          </Button>
                          {canPurge && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-destructive hover:text-destructive"
                              onClick={() => onPurgeOne(r)}
                              aria-label="Delete recording"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {recordings.length > 50 && (
                <p className="pt-2 text-xs text-muted-foreground">
                  Showing 50 of {recordings.length}. Export CSV for the full list.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <RecordingPlayerDialog
        recording={playerRecording}
        open={!!playerRecording}
        onOpenChange={(o) => { if (!o) setPlayerRecording(null); }}
      />
    </div>
  );
};

const KpiCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | null;
  sub: string;
}> = ({ icon, label, value, sub }) => (
  <Card>
    <CardContent className="p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {value ?? <Skeleton className="h-7 w-20" />}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
    </CardContent>
  </Card>
);

function formatDuration(ms: number): string {
  if (!ms || ms < 1000) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export default CallAnalytics;
