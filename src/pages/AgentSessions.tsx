import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Eye, Monitor, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import {
  subscribeAgentSessions,
  type AgentSession,
} from "@/lib/agentPresence";

/**
 * Webmaster-only Read-Only Session Mirror.
 *
 * Lists every active agent session with their current route, selected
 * conversation/thread, viewport, and last action time. Clicking "View"
 * navigates the webmaster's own browser to the same route — they see the
 * same data the agent is looking at without any screen-pixel sharing.
 *
 * No remote control. No keystroke capture. No screen capture. Purely a
 * Firestore-backed presence mirror for troubleshooting.
 */
const STALE_MS = 5 * 60 * 1000;

function relTime(ms: number | undefined): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleString();
}

const AgentSessions: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (profile?.role !== "webmaster") return;
    return subscribeAgentSessions(setSessions);
  }, [profile?.role]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.displayName?.toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q) ||
        s.route?.toLowerCase().includes(q) ||
        s.role?.toLowerCase().includes(q)
    );
  }, [sessions, filter]);

  const now = Date.now();
  const liveCount = sessions.filter(
    (s) => now - (s.lastActionAt?.toMillis?.() ?? 0) < STALE_MS
  ).length;

  if (profile?.role !== "webmaster") {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Webmaster role required.
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 space-y-6 max-w-6xl"
    >
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Monitor className="h-6 w-6 text-primary" />
          <h1
            className="text-3xl font-bold text-foreground"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Agent sessions
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Read-only mirror of every signed-in teammate's current route and selected thread.
          Click <strong className="text-foreground">View</strong> to open the same screen in
          your browser. No screen pixels are captured.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Live now</CardDescription>
            <CardTitle className="text-3xl text-success">{liveCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total tracked</CardDescription>
            <CardTitle className="text-3xl">{sessions.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="flex gap-2 items-center">
        <Input
          placeholder="Filter by name, email, route…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-sm"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFilter("")}
          disabled={!filter}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Clear
        </Button>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No agent sessions match.
            </CardContent>
          </Card>
        )}
        {filtered.map((s) => {
          const lastMs = s.lastActionAt?.toMillis?.() ?? 0;
          const live = now - lastMs < STALE_MS;
          return (
            <Card key={s.uid}>
              <CardContent className="p-4 flex flex-wrap items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {(s.displayName || s.email || "?").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground truncate">
                      {s.displayName || s.email || s.uid}
                    </span>
                    {s.role && (
                      <Badge variant="outline" className="capitalize text-[10px]">
                        {s.role}
                      </Badge>
                    )}
                    {live ? (
                      <Badge className="bg-success/15 text-success border-success/30 text-[10px]">
                        Live · {relTime(lastMs)}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        Idle · {relTime(lastMs)}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground truncate">
                    <code className="rounded bg-muted px-1.5 py-0.5">{s.route || "/"}</code>
                    {s.conversationId && (
                      <span className="ml-2">conv: {s.conversationId}</span>
                    )}
                    {s.chatThreadId && (
                      <span className="ml-2">thread: {s.chatThreadId}</span>
                    )}
                    {s.viewport && (
                      <span className="ml-2">
                        viewport: {s.viewport.w}×{s.viewport.h}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(s.route || "/")}
                  className="gap-1"
                >
                  <Eye className="h-3.5 w-3.5" />
                  View
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Privacy: agents do not receive a prompt because no screen pixels, keystrokes, or
        input values are transmitted — only their current route and selected thread ID
        (already visible in URL bars). The presence row is updated at most once every
        5 seconds.
      </p>
    </motion.div>
  );
};

export default AgentSessions;
