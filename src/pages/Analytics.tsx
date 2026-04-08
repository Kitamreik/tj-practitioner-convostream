import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { BarChart3, Users, MessageSquare, Clock, TrendingUp, UserCheck } from "lucide-react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

interface AgentWorkloadData {
  name: string;
  active: number;
  waiting: number;
  resolved: number;
}

const fallbackAgentWorkload: AgentWorkloadData[] = [
  { name: "Alice Johnson", active: 12, waiting: 3, resolved: 45 },
  { name: "Bob Smith", active: 8, waiting: 5, resolved: 38 },
  { name: "Carol Davis", active: 15, waiting: 2, resolved: 52 },
  { name: "Dan Lee", active: 6, waiting: 7, resolved: 29 },
];

const stats = [
  { label: "Total Conversations", value: "1,284", change: "+12%", icon: <MessageSquare className="h-5 w-5" /> },
  { label: "Active Customers", value: "342", change: "+8%", icon: <Users className="h-5 w-5" /> },
  { label: "Avg Response Time", value: "2m 14s", change: "-18%", icon: <Clock className="h-5 w-5" /> },
  { label: "Resolution Rate", value: "94.2%", change: "+3%", icon: <TrendingUp className="h-5 w-5" /> },
];

const Analytics: React.FC = () => {
  const [agentWorkload, setAgentWorkload] = useState<AgentWorkloadData[]>(fallbackAgentWorkload);

  // Listen to conversations and compute per-agent workload
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "conversations"),
      (snapshot) => {
        const agentMap: Record<string, AgentWorkloadData> = {};

        snapshot.docs.forEach((doc) => {
          const data = doc.data();
          const agent = data.assignedAgent || "Unassigned";
          if (!agentMap[agent]) {
            agentMap[agent] = { name: agent, active: 0, waiting: 0, resolved: 0 };
          }
          if (data.status === "active") agentMap[agent].active++;
          else if (data.status === "waiting") agentMap[agent].waiting++;
          else if (data.status === "resolved") agentMap[agent].resolved++;
        });

        const result = Object.values(agentMap);
        setAgentWorkload(result.length > 0 ? result : fallbackAgentWorkload);
      },
      () => {
        setAgentWorkload(fallbackAgentWorkload);
      }
    );
    return unsub;
  }, []);

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
