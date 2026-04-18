import React, { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { BarChart3, Users, MessageSquare, Clock, TrendingUp, UserCheck, PhoneIncoming, PhoneOutgoing, MessageCircle, Filter, X, Activity } from "lucide-react";
import { collection, onSnapshot, query, orderBy, limit, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { subscribeLocalAgents } from "@/lib/localAgents";

interface AgentWorkloadData {
  name: string;
  active: number;
  waiting: number;
  resolved: number;
}

interface VoiceActivity {
  id: string;
  type: "call_inbound" | "call_outbound" | "sms_inbound" | "sms_outbound";
  contact: string;
  durationSec?: number;
  preview?: string;
  timestamp: any;
}

// Sample data shown only when no real agents exist yet on the Agents page
// (i.e. brand-new tenant). Once real agents are added, this is never used.
const sampleAgentWorkload: AgentWorkloadData[] = [
  { name: "Alice Johnson", active: 12, waiting: 3, resolved: 45 },
  { name: "Bob Smith", active: 8, waiting: 5, resolved: 38 },
  { name: "Carol Davis", active: 15, waiting: 2, resolved: 52 },
  { name: "Dan Lee", active: 6, waiting: 7, resolved: 29 },
];

const fallbackVoiceActivity: VoiceActivity[] = [
  { id: "v1", type: "call_inbound", contact: "+1 555-0142", durationSec: 184, timestamp: { toDate: () => new Date(Date.now() - 60_000) } },
  { id: "v2", type: "sms_inbound", contact: "+1 555-0118", preview: "Hi, can someone help me with a refund?", timestamp: { toDate: () => new Date(Date.now() - 8 * 60_000) } },
  { id: "v3", type: "call_outbound", contact: "+1 555-0177", durationSec: 92, timestamp: { toDate: () => new Date(Date.now() - 22 * 60_000) } },
  { id: "v4", type: "sms_outbound", contact: "+1 555-0118", preview: "Of course — what's your order number?", timestamp: { toDate: () => new Date(Date.now() - 7 * 60_000) } },
];

const stats = [
  { label: "Total Conversations", value: "1,284", change: "+12%", icon: <MessageSquare className="h-5 w-5" /> },
  { label: "Active Customers", value: "342", change: "+8%", icon: <Users className="h-5 w-5" /> },
  { label: "Avg Response Time", value: "2m 14s", change: "-18%", icon: <Clock className="h-5 w-5" /> },
  { label: "Resolution Rate", value: "94.2%", change: "+3%", icon: <TrendingUp className="h-5 w-5" /> },
];

const Analytics: React.FC = () => {
  const [agentWorkload, setAgentWorkload] = useState<AgentWorkloadData[]>([]);
  const [voiceActivity, setVoiceActivity] = useState<VoiceActivity[]>(fallbackVoiceActivity);
  const [voiceLive, setVoiceLive] = useState(false);
  // Last-7-days raw call activity (separate listener — needs more rows than the live feed).
  const [voiceWeek, setVoiceWeek] = useState<VoiceActivity[]>([]);
  const [numberFilter, setNumberFilter] = useState<string>("all");

  // Live agent roster — Firestore users (agent/admin) + manually-added local
  // agents. The workload chart is restricted to this set so it always matches
  // what's on the Agents page (no orphan names from old conversations, no
  // "Unassigned" bucket cluttering the staff view).
  const [firestoreAgentNames, setFirestoreAgentNames] = useState<string[]>([]);
  const [localAgentNames, setLocalAgentNames] = useState<string[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const names = snap.docs
          .map((d) => d.data() as any)
          .filter((u) => u && (u.role === "agent" || u.role === "admin") && (u.displayName || u.email))
          .map((u) => (u.displayName || u.email) as string);
        setFirestoreAgentNames(Array.from(new Set(names)));
      },
      () => setFirestoreAgentNames([])
    );
    return unsub;
  }, []);
  useEffect(
    () => subscribeLocalAgents((rows) => setLocalAgentNames(rows.map((r) => r.displayName).filter(Boolean))),
    []
  );
  const knownAgentSet = useMemo(
    () => new Set([...firestoreAgentNames, ...localAgentNames].map((n) => n.toLowerCase())),
    [firestoreAgentNames, localAgentNames]
  );
  const knownAgentList = useMemo(
    () => Array.from(new Set([...firestoreAgentNames, ...localAgentNames])).sort((a, b) => a.localeCompare(b)),
    [firestoreAgentNames, localAgentNames]
  );

  // Listen to conversations and compute per-agent workload — restricted to
  // agents that exist on the Agents page. We pre-seed every known agent with
  // zeros so brand-new agents render an "all idle" row instead of being missing.
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "conversations"),
      (snapshot) => {
        const agentMap: Record<string, AgentWorkloadData> = {};
        // Pre-seed so every known agent appears, even with zero workload.
        knownAgentList.forEach((n) => {
          agentMap[n] = { name: n, active: 0, waiting: 0, resolved: 0 };
        });

        snapshot.docs.forEach((doc) => {
          const data = doc.data();
          const agent = (data.assignedAgent || "").trim();
          // Skip unassigned and any orphan names not on the Agents page.
          if (!agent || !knownAgentSet.has(agent.toLowerCase())) return;
          if (!agentMap[agent]) {
            agentMap[agent] = { name: agent, active: 0, waiting: 0, resolved: 0 };
          }
          if (data.status === "active") agentMap[agent].active++;
          else if (data.status === "waiting") agentMap[agent].waiting++;
          else if (data.status === "resolved") agentMap[agent].resolved++;
        });

        const result = Object.values(agentMap).sort((a, b) => a.name.localeCompare(b.name));
        // Only fall back to sample data when there's no roster at all (fresh tenant).
        setAgentWorkload(
          result.length > 0 ? result : knownAgentList.length === 0 ? sampleAgentWorkload : []
        );
      },
      () => {
        setAgentWorkload(knownAgentList.length === 0 ? sampleAgentWorkload : []);
      }
    );
    return unsub;
  }, [knownAgentList, knownAgentSet]);

  // Listen to Google Voice activity (calls + SMS) in real time
  useEffect(() => {
    try {
      const q = query(collection(db, "googleVoiceActivity"), orderBy("timestamp", "desc"), limit(10));
      const unsub = onSnapshot(
        q,
        (snap) => {
          if (snap.empty) {
            setVoiceActivity(fallbackVoiceActivity);
            setVoiceLive(false);
          } else {
            setVoiceActivity(snap.docs.map((d) => ({ id: d.id, ...d.data() } as VoiceActivity)));
            setVoiceLive(true);
          }
        },
        () => {
          setVoiceActivity(fallbackVoiceActivity);
          setVoiceLive(false);
        }
      );
      return unsub;
    } catch {
      setVoiceActivity(fallbackVoiceActivity);
      setVoiceLive(false);
    }
  }, []);

  // Pull the last 7 days of call activity for the per-number sparkline.
  // Separate from the live feed so we can request more rows without bloating that list.
  useEffect(() => {
    try {
      const sevenDaysAgo = Timestamp.fromDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
      const q = query(
        collection(db, "googleVoiceActivity"),
        where("timestamp", ">=", sevenDaysAgo),
        orderBy("timestamp", "asc"),
        limit(500)
      );
      const unsub = onSnapshot(
        q,
        (snap) => {
          if (snap.empty) {
            // Fall back to a deterministic synthetic 7-day series so the sparkline isn't blank.
            const syntheticBase = Date.now() - 6 * 86_400_000;
            setVoiceWeek(
              Array.from({ length: 14 }).map((_, i) => ({
                id: `syn-${i}`,
                type: i % 3 === 0 ? "call_outbound" : "call_inbound",
                contact: i % 2 === 0 ? "+1 555-0142" : "+1 555-0177",
                timestamp: { toDate: () => new Date(syntheticBase + (i % 7) * 86_400_000) } as any,
              }))
            );
          } else {
            setVoiceWeek(snap.docs.map((d) => ({ id: d.id, ...d.data() } as VoiceActivity)));
          }
        },
        () => setVoiceWeek([])
      );
      return unsub;
    } catch {
      setVoiceWeek([]);
    }
  }, []);

  // Unique numbers across all observed voice activity (for the filter dropdown)
  const voiceNumbers = useMemo(() => {
    const set = new Set<string>();
    voiceActivity.forEach((v) => v.contact && set.add(v.contact));
    voiceWeek.forEach((v) => v.contact && set.add(v.contact));
    return Array.from(set).sort();
  }, [voiceActivity, voiceWeek]);

  // Bucket the last 7 days of CALL activity (inbound + outbound) by day for the
  // selected number. Returns an array of length 7 — index 0 = 6 days ago, index 6 = today.
  const sparklineData = useMemo(() => {
    const days: { label: string; date: Date; count: number }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push({
        label: d.toLocaleDateString(undefined, { weekday: "short" }),
        date: d,
        count: 0,
      });
    }
    const filtered = voiceWeek.filter(
      (v) =>
        (v.type === "call_inbound" || v.type === "call_outbound") &&
        (numberFilter === "all" || v.contact === numberFilter)
    );
    filtered.forEach((v) => {
      const d: Date | null = v.timestamp?.toDate ? v.timestamp.toDate() : null;
      if (!d) return;
      const idx = days.findIndex(
        (b) =>
          b.date.getFullYear() === d.getFullYear() &&
          b.date.getMonth() === d.getMonth() &&
          b.date.getDate() === d.getDate()
      );
      if (idx >= 0) days[idx].count += 1;
    });
    return days;
  }, [voiceWeek, numberFilter]);

  const sparklineMax = useMemo(() => Math.max(1, ...sparklineData.map((d) => d.count)), [sparklineData]);
  const sparklineTotal = useMemo(() => sparklineData.reduce((s, d) => s + d.count, 0), [sparklineData]);

  // Apply the active-number filter to the activity feed and stats
  const filteredVoiceActivity = useMemo(
    () => (numberFilter === "all" ? voiceActivity : voiceActivity.filter((v) => v.contact === numberFilter)),
    [voiceActivity, numberFilter]
  );

  const voiceStats = {
    inboundCalls: filteredVoiceActivity.filter((v) => v.type === "call_inbound").length,
    outboundCalls: filteredVoiceActivity.filter((v) => v.type === "call_outbound").length,
    inboundSms: filteredVoiceActivity.filter((v) => v.type === "sms_inbound").length,
    outboundSms: filteredVoiceActivity.filter((v) => v.type === "sms_outbound").length,
  };

  const formatRelative = (ts: any): string => {
    const d = ts?.toDate ? ts.toDate() : null;
    if (!d) return "—";
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  const formatDuration = (s?: number) => {
    if (!s) return "";
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const voiceIcon = (type: VoiceActivity["type"]) => {
    if (type === "call_inbound") return <PhoneIncoming className="h-4 w-4 text-success" />;
    if (type === "call_outbound") return <PhoneOutgoing className="h-4 w-4 text-primary" />;
    if (type === "sms_inbound") return <MessageCircle className="h-4 w-4 text-success" />;
    return <MessageCircle className="h-4 w-4 text-primary" />;
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <BarChart3 className="h-7 w-7 text-primary" />
          Analytics
        </h1>
        <p className="text-muted-foreground mt-1">Performance overview of your support operations</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="rounded-xl border border-border bg-card p-6"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {stat.icon}
              </div>
              <span className="text-xs font-medium text-success">{stat.change}</span>
            </div>
            <p className="text-2xl font-bold text-card-foreground">{stat.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-6 mb-8">
        <h3 className="text-lg font-semibold text-card-foreground mb-4">Conversation Volume</h3>
        <div className="flex items-end gap-2 h-48">
          {[35, 52, 48, 70, 65, 82, 90, 78, 95, 88, 72, 60].map((val, i) => (
            <motion.div
              key={i}
              initial={{ height: 0 }}
              animate={{ height: `${val}%` }}
              transition={{ delay: i * 0.05, duration: 0.4 }}
              className="flex-1 rounded-t-md bg-primary/70 hover:bg-primary transition-colors cursor-pointer"
              title={`Month ${i + 1}: ${val} conversations`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-2 text-xs text-muted-foreground">
          <span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span>
          <span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span><span>Nov</span><span>Dec</span>
        </div>
      </div>

      {/* Google Voice Live Engagement */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="rounded-xl border border-border bg-card p-6 mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
            <PhoneIncoming className="h-5 w-5 text-primary" />
            Google Voice — Live Engagement
          </h3>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <Select value={numberFilter} onValueChange={setNumberFilter}>
                <SelectTrigger className="h-8 w-[180px] text-xs" aria-label="Filter by Google Voice number">
                  <SelectValue placeholder="All numbers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All numbers</SelectItem>
                  {voiceNumbers.map((n) => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {numberFilter !== "all" && (
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setNumberFilter("all")} aria-label="Clear filter">
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <span className="flex items-center gap-1.5 text-xs">
              <span className={`h-2 w-2 rounded-full ${voiceLive ? "bg-success animate-pulse" : "bg-muted-foreground/40"}`} />
              <span className="text-muted-foreground">{voiceLive ? "Live" : "Sample data"}</span>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><PhoneIncoming className="h-3.5 w-3.5 text-success" /> Inbound calls</div>
            <p className="text-xl font-bold text-card-foreground mt-1">{voiceStats.inboundCalls}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><PhoneOutgoing className="h-3.5 w-3.5 text-primary" /> Outbound calls</div>
            <p className="text-xl font-bold text-card-foreground mt-1">{voiceStats.outboundCalls}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><MessageCircle className="h-3.5 w-3.5 text-success" /> Inbound SMS</div>
            <p className="text-xl font-bold text-card-foreground mt-1">{voiceStats.inboundSms}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><MessageCircle className="h-3.5 w-3.5 text-primary" /> Outbound SMS</div>
            <p className="text-xl font-bold text-card-foreground mt-1">{voiceStats.outboundSms}</p>
          </div>
        </div>

        {/* 7-day call volume sparkline. Bars scale to the per-window max so even
            small differences are visible. Reflects the active number filter. */}
        <div className="rounded-lg border border-border bg-muted/20 p-3 mb-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              7-day call volume
              <span className="ml-1 text-[10px] font-normal text-muted-foreground/80 normal-case tracking-normal">
                {numberFilter === "all" ? "(all numbers)" : `(${numberFilter})`}
              </span>
            </p>
            <span className="text-[11px] text-muted-foreground">
              {sparklineTotal} call{sparklineTotal === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex items-end gap-1.5 h-14">
            {sparklineData.map((d, i) => {
              const pct = (d.count / sparklineMax) * 100;
              return (
                <div
                  key={i}
                  className="flex-1 bg-primary/70 hover:bg-primary transition-colors rounded-sm min-w-0"
                  style={{ height: `${Math.max(4, pct)}%` }}
                  title={`${d.label}: ${d.count} call${d.count === 1 ? "" : "s"}`}
                  aria-label={`${d.label}: ${d.count} calls`}
                />
              );
            })}
          </div>
          <div className="flex gap-1.5 mt-1.5">
            {sparklineData.map((d, i) => (
              <span key={i} className="flex-1 text-center text-[10px] text-muted-foreground">
                {d.label.charAt(0)}
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent activity</p>
          {filteredVoiceActivity.slice(0, 6).map((v) => (
            <div key={v.id} className="flex items-center gap-3 rounded-lg border border-border/60 p-3 hover:bg-muted/30 transition-colors">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted">
                {voiceIcon(v.type)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-card-foreground truncate">{v.contact}</span>
                  <span className="text-xs text-muted-foreground flex-shrink-0">{formatRelative(v.timestamp)}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {v.type.startsWith("call") ? `Call · ${formatDuration(v.durationSec)}` : v.preview || "SMS"}
                </p>
              </div>
            </div>
          ))}
          {filteredVoiceActivity.length === 0 && (
            <p className="text-xs text-muted-foreground italic px-1 py-3">No activity for this number yet.</p>
          )}
        </div>
      </motion.div>

      {/* Agent Workload */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="rounded-xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold text-card-foreground mb-4 flex items-center gap-2">
          <UserCheck className="h-5 w-5 text-primary" />
          Agent Workload
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Agent</th>
                <th className="text-center py-3 px-4 font-medium text-muted-foreground">Active</th>
                <th className="text-center py-3 px-4 font-medium text-muted-foreground">Waiting</th>
                <th className="text-center py-3 px-4 font-medium text-muted-foreground">Resolved</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground">Load</th>
              </tr>
            </thead>
            <tbody>
              {agentWorkload.map((agent) => {
                const total = agent.active + agent.waiting;
                const loadPct = Math.min(100, Math.round((total / 20) * 100));
                return (
                  <tr key={agent.name} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                          {agent.name.charAt(0)}
                        </div>
                        <span className="font-medium text-foreground">{agent.name}</span>
                      </div>
                    </td>
                    <td className="text-center py-3 px-4"><span className="inline-flex h-6 items-center rounded-full bg-success/10 px-2 text-xs font-medium text-success">{agent.active}</span></td>
                    <td className="text-center py-3 px-4"><span className="inline-flex h-6 items-center rounded-full bg-warning/10 px-2 text-xs font-medium text-warning">{agent.waiting}</span></td>
                    <td className="text-center py-3 px-4 text-muted-foreground">{agent.resolved}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-20 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${loadPct > 75 ? "bg-destructive" : loadPct > 50 ? "bg-warning" : "bg-success"}`}
                            style={{ width: `${loadPct}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">{loadPct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
};

export default Analytics;
