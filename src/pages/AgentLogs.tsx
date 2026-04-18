import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ScrollText,
  Search,
  Filter,
  RotateCcw,
  Mail,
  MessageSquare,
  Phone,
  Hash,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { collection, doc, onSnapshot, orderBy, query, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { subscribeLocalAgents } from "@/lib/localAgents";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import PullToRefresh from "@/components/PullToRefresh";

/**
 * Agent Logs — read-only history of resolved conversations, grouped by the
 * agent (or admin) who closed them out. Webmasters and admins land here from
 * the sidebar; agents see only their own resolved threads.
 *
 * Source of truth is `conversations` with status === "resolved". When the
 * webmaster/agent reopens one from this page, it moves back to the main
 * Conversations queue (status flipped to "active").
 */

interface ResolvedConvo {
  id: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  channel: "email" | "sms" | "phone" | "slack";
  lastMessage: string;
  assignedAgent?: string;
  archived?: boolean;
  timestamp?: any;
  // When the conversation first appeared, used as the "opened at" anchor
  // for time-to-resolve when the dedicated `createdAt` field is missing.
  createdAt?: any;
  // Stamped by Conversations.tsx when status flips to "resolved".
  resolvedAt?: any;
  resolvedBy?: string | null;
}

const channelIcon: Record<ResolvedConvo["channel"], React.ReactNode> = {
  email: <Mail className="h-3.5 w-3.5" />,
  sms: <MessageSquare className="h-3.5 w-3.5" />,
  phone: <Phone className="h-3.5 w-3.5" />,
  slack: <Hash className="h-3.5 w-3.5" />,
};

const formatRelative = (ts: any): string => {
  const d: Date | null = ts?.toDate ? ts.toDate() : null;
  if (!d) return "—";
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
};

const AgentLogs: React.FC = () => {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const isStaff = profile?.role === "webmaster" || profile?.role === "admin";

  const [resolved, setResolved] = useState<ResolvedConvo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [reopeningId, setReopeningId] = useState<string | null>(null);

  // Known agents (Firestore + local roster). Used to populate the agent filter
  // dropdown so it stays in sync with what's actually on /agents.
  const [knownAgents, setKnownAgents] = useState<string[]>([]);
  const [localAgents, setLocalAgents] = useState<string[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const names = snap.docs
          .map((d) => d.data() as any)
          .filter((u) => u && (u.role === "agent" || u.role === "admin") && (u.displayName || u.email))
          .map((u) => (u.displayName || u.email) as string);
        setKnownAgents(Array.from(new Set(names)));
      },
      () => setKnownAgents([])
    );
    return unsub;
  }, []);
  useEffect(
    () => subscribeLocalAgents((rows) => setLocalAgents(rows.map((r) => r.displayName).filter(Boolean))),
    []
  );
  const allAgentNames = useMemo(
    () => Array.from(new Set([...knownAgents, ...localAgents])).sort((a, b) => a.localeCompare(b)),
    [knownAgents, localAgents]
  );

  useEffect(() => {
    // Resolved conversations only. Includes archived-and-resolved so the log
    // is a complete history, not just whatever happens to be unarchived.
    const q = query(
      collection(db, "conversations"),
      where("status", "==", "resolved"),
      orderBy("timestamp", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setError(null);
        setResolved(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as ResolvedConvo)));
        setLoading(false);
      },
      (err) => {
        console.warn("AgentLogs listener error:", err);
        setError("Could not load resolved conversations.");
        setResolved([]);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  // Agents see only their own resolved conversations; webmasters/admins see all.
  const myAgentName = (profile?.displayName?.trim() || profile?.email?.trim() || "").toLowerCase();
  const visible = useMemo(() => {
    let rows = resolved;
    if (!isStaff) {
      rows = rows.filter((r) => (r.assignedAgent || "").toLowerCase() === myAgentName);
    }
    if (agentFilter !== "all") {
      rows = rows.filter((r) => (r.assignedAgent || "—") === agentFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.customerName.toLowerCase().includes(q) ||
          (r.lastMessage || "").toLowerCase().includes(q) ||
          (r.assignedAgent || "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [resolved, isStaff, myAgentName, agentFilter, search]);

  // Group by agent for the staff view; flat list for solo agents.
  const groups = useMemo(() => {
    const map = new Map<string, ResolvedConvo[]>();
    for (const r of visible) {
      const key = r.assignedAgent || "Unassigned";
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [visible]);

  // Per-agent resolution metrics:
  //  - avgResolveMs: mean of (resolvedAt - createdAt|timestamp) across rows
  //    that have a resolvedAt. Conversations without resolvedAt are skipped
  //    so we don't penalize legacy data with bogus zero/huge durations.
  //  - resolvedThisWeek: count of rows resolved between Mon 00:00 and now
  //    in the user's local timezone (matches how teams report weekly perf).
  const weekStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    // Date.getDay(): Sunday=0, Monday=1, ..., Saturday=6 → shift to Monday-anchored
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return d.getTime();
  }, []);

  const metricsByAgent = useMemo(() => {
    const out = new Map<string, { avgResolveMs: number | null; resolvedThisWeek: number }>();
    for (const [agentName, rows] of groups) {
      let sum = 0;
      let count = 0;
      let weekly = 0;
      for (const r of rows) {
        const resolvedDate: Date | null = r.resolvedAt?.toDate ? r.resolvedAt.toDate() : null;
        if (!resolvedDate) continue;
        // Anchor: prefer createdAt (when conversation first appeared), fall
        // back to `timestamp` which is updated on every new message — so it's
        // a lower bound but better than nothing for legacy rows.
        const startTs = r.createdAt?.toDate ? r.createdAt.toDate() : r.timestamp?.toDate ? r.timestamp.toDate() : null;
        if (startTs && resolvedDate.getTime() >= startTs.getTime()) {
          sum += resolvedDate.getTime() - startTs.getTime();
          count++;
        }
        if (resolvedDate.getTime() >= weekStart) weekly++;
      }
      out.set(agentName, {
        avgResolveMs: count > 0 ? Math.round(sum / count) : null,
        resolvedThisWeek: weekly,
      });
    }
    return out;
  }, [groups, weekStart]);

  const formatDuration = (ms: number): string => {
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = min / 60;
    if (hr < 24) return `${hr.toFixed(hr < 10 ? 1 : 0)}h`;
    const days = hr / 24;
    return `${days.toFixed(days < 10 ? 1 : 0)}d`;
  };

  const handleReopen = async (convo: ResolvedConvo) => {
    setReopeningId(convo.id);
    try {
      // Clear resolvedAt/resolvedBy so a future re-resolve gets a fresh
      // duration measurement and metrics aren't double-counted.
      await updateDoc(doc(db, "conversations", convo.id), {
        status: "active",
        resolvedAt: null,
        resolvedBy: null,
      });
      toast({
        title: "Reopened",
        description: `${convo.customerName} moved back to Conversations.`,
      });
    } catch (e: any) {
      toast({
        title: "Could not reopen",
        description: e?.message || "Try again.",
        variant: "destructive",
      });
    } finally {
      setReopeningId(null);
    }
  };

  const handleRefresh = async () => {
    await new Promise((r) => setTimeout(r, 400));
    toast({ title: "Refreshed" });
  };

  return (
    <PullToRefresh onRefresh={handleRefresh} disabled={!isMobile} className="h-full">
      <div className="p-4 md:p-8 max-w-6xl mx-auto">
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <ScrollText className="h-7 w-7 text-primary" />
            Agent Logs
          </h1>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">
            {isStaff
              ? "Resolved conversations across every agent and admin."
              : "Your resolved conversations."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customer, message, or agent…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {isStaff && (
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="h-9 w-[200px] text-xs">
                  <SelectValue placeholder="All agents" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All agents</SelectItem>
                  {allAgentNames.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                  <SelectItem value="Unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <Badge variant="secondary" className="text-xs">
            {visible.length} resolved
          </Badge>
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
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">No resolved conversations yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              When you mark a conversation as resolved, it will show up here.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map(([agentName, rows], gi) => (
              <motion.div
                key={agentName}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: gi * 0.04 }}
                className="rounded-xl border border-border bg-card overflow-hidden"
              >
                <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {agentName.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm font-medium text-foreground truncate">{agentName}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    {(() => {
                      const m = metricsByAgent.get(agentName);
                      const avg = m?.avgResolveMs;
                      const week = m?.resolvedThisWeek ?? 0;
                      return (
                        <>
                          <Badge
                            variant="secondary"
                            className="text-[10px]"
                            title="Resolved between Monday 00:00 and now (your local timezone)"
                          >
                            {week} this week
                          </Badge>
                          <Badge
                            variant="secondary"
                            className="text-[10px]"
                            title="Average time from first message (or earliest record) to resolution"
                          >
                            {avg != null ? `avg ${formatDuration(avg)}` : "avg —"}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {rows.length} resolved
                          </Badge>
                        </>
                      );
                    })()}
                  </div>
                </div>
                <ul className="divide-y divide-border">
                  {rows.map((r) => (
                    <li key={r.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        {channelIcon[r.channel] ?? <MessageSquare className="h-3.5 w-3.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-foreground truncate">
                            {r.customerName}
                          </p>
                          {r.archived && (
                            <Badge variant="outline" className="text-[10px]">Archived</Badge>
                          )}
                          <span className="text-[11px] text-muted-foreground">
                            {formatRelative(r.timestamp)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {r.lastMessage || "(no preview)"}
                        </p>
                        {(r.customerEmail || r.customerPhone) && (
                          <p className="text-[11px] text-muted-foreground/80 truncate mt-0.5">
                            {r.customerEmail || r.customerPhone}
                          </p>
                        )}
                      </div>
                      {/* Reopen is allowed for staff or for the agent who owns the thread. */}
                      {(isStaff || (r.assignedAgent || "").toLowerCase() === myAgentName) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reopeningId === r.id}
                          onClick={() => handleReopen(r)}
                          className="gap-1.5 h-8 flex-shrink-0"
                          aria-label={`Reopen ${r.customerName}`}
                        >
                          {reopeningId === r.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          <span className="hidden sm:inline">Reopen</span>
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </PullToRefresh>
  );
};

export default AgentLogs;
