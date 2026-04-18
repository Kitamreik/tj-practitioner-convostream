import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, ShieldCheck, UserCog, ArrowDown, ArrowUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import PullToRefresh from "@/components/PullToRefresh";
import { useIsMobile } from "@/hooks/use-mobile";

interface AgentRow {
  uid: string;
  email: string;
  displayName: string;
  role: "agent" | "admin" | "webmaster";
  escalatedAccess?: boolean;
  createdAt?: any;
}

const roleLabel: Record<AgentRow["role"], string> = {
  agent: "Agent",
  admin: "Admin",
  webmaster: "Webmaster",
};

const roleVariant: Record<AgentRow["role"], "default" | "secondary" | "outline"> = {
  agent: "secondary",
  admin: "default",
  webmaster: "outline",
};

const Agents: React.FC = () => {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const isWebmaster = profile?.role === "webmaster";

  const [users, setUsers] = useState<AgentRow[]>([]);
  const [search, setSearch] = useState("");
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "users"), orderBy("createdAt", "desc")),
      (snap) => {
        setError(null);
        setUsers(
          snap.docs.map((d) => {
            const data = d.data() as any;
            return {
              uid: d.id,
              email: data.email ?? "",
              displayName: data.displayName ?? "",
              role: (data.role ?? "agent") as AgentRow["role"],
              escalatedAccess: !!data.escalatedAccess,
              createdAt: data.createdAt,
            };
          })
        );
      },
      (err) => {
        console.warn("Agents listener error:", err);
        // Non-webmasters cannot list /users (Firestore rules); fall back to
        // showing only the signed-in profile so the page still feels useful.
        if (profile) {
          setUsers([
            {
              uid: profile.uid,
              email: profile.email,
              displayName: profile.displayName,
              role: profile.role,
              escalatedAccess: profile.escalatedAccess,
            },
          ]);
        }
        setError(
          isWebmaster
            ? "Could not load accounts. Check Firestore rules deployment."
            : "Only webmasters can see the full agent roster."
        );
      }
    );
    return unsub;
  }, [profile, isWebmaster]);

  const filtered = useMemo(
    () =>
      users
        .filter((u) =>
          search.trim() === ""
            ? true
            : (u.displayName || "").toLowerCase().includes(search.toLowerCase()) ||
              (u.email || "").toLowerCase().includes(search.toLowerCase())
        )
        .sort((a, b) => {
          // Webmasters last so the working agents float to the top.
          const order = { agent: 0, admin: 1, webmaster: 2 } as const;
          return order[a.role] - order[b.role] || a.displayName.localeCompare(b.displayName);
        }),
    [users, search]
  );

  const setRole = async (acc: AgentRow, target: "agent" | "admin") => {
    if (!acc.email) {
      toast({ title: "No email on account", variant: "destructive" });
      return;
    }
    setBusyUid(acc.uid);
    try {
      if (target === "admin") {
        const fn = httpsCallable<
          { targetEmail: string; role: "admin" },
          { ok: boolean; previousRole: string; newRole: string }
        >(functions, "promoteToWebmaster");
        const res = await fn({ targetEmail: acc.email, role: "admin" });
        toast({
          title: "Promoted to admin",
          description: `${acc.email} ${res.data.previousRole} → ${res.data.newRole}.`,
        });
      } else {
        const fn = httpsCallable<{ targetUid: string }, { ok: boolean }>(
          functions,
          "demoteAgent"
        );
        await fn({ targetUid: acc.uid });
        toast({
          title: "Set to agent",
          description: `${acc.email || acc.uid} is now an agent.`,
        });
      }
    } catch (e: any) {
      toast({
        title: target === "admin" ? "Promote failed" : "Demote failed",
        description: e?.message || "Cloud Function unavailable.",
        variant: "destructive",
      });
    } finally {
      setBusyUid(null);
    }
  };

  const handleRefresh = async () => {
    await new Promise((r) => setTimeout(r, 400));
    toast({ title: "Refreshed" });
  };

  const counts = useMemo(() => {
    const c = { agent: 0, admin: 0, webmaster: 0 };
    for (const u of users) c[u.role]++;
    return c;
  }, [users]);

  return (
    <PullToRefresh onRefresh={handleRefresh} disabled={!isMobile} className="h-full">
      <div className="p-4 md:p-8 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6 md:mb-8">
          <div>
            <h1 className="hidden md:block text-2xl font-bold text-foreground">Agents</h1>
            <p className="text-muted-foreground mt-1 text-sm md:text-base">
              Accounts assigned to handle customer conversations
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="secondary">{counts.agent} agents</Badge>
            <Badge>{counts.admin} admins</Badge>
            <Badge variant="outline">{counts.webmaster} webmasters</Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email…"
              className="pl-9 max-w-md"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {error}
          </p>
        )}

        {/* Mobile cards */}
        <div className="md:hidden space-y-2">
          {filtered.map((u, i) => (
            <motion.div
              key={u.uid}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {(u.displayName || u.email || "?").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-foreground truncate">
                      {u.displayName || "(unnamed)"}
                    </p>
                    <Badge variant={roleVariant[u.role]} className="text-[10px]">
                      {roleLabel[u.role]}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{u.email || u.uid}</p>
                  {isWebmaster && u.role !== "webmaster" && u.uid !== profile?.uid && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {u.role === "agent" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyUid === u.uid}
                          onClick={() => setRole(u, "admin")}
                          className="gap-1.5 h-8"
                        >
                          <ArrowUp className="h-3.5 w-3.5" /> Promote to admin
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyUid === u.uid}
                          onClick={() => setRole(u, "agent")}
                          className="gap-1.5 h-8"
                        >
                          <ArrowDown className="h-3.5 w-3.5" /> Set as agent
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No agents found.</p>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block rounded-xl border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Agent
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Access
                </th>
                {isWebmaster && (
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => (
                <motion.tr
                  key={u.uid}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                        {(u.displayName || u.email || "?").charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-foreground">
                        {u.displayName || "(unnamed)"}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{u.email || "—"}</td>
                  <td className="px-6 py-4">
                    <Badge variant={roleVariant[u.role]} className="text-xs">
                      {roleLabel[u.role]}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-xs text-muted-foreground">
                    {u.role === "webmaster" ? (
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5" /> Full access
                      </span>
                    ) : u.escalatedAccess ? (
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5" /> Escalated
                      </span>
                    ) : (
                      "Standard"
                    )}
                  </td>
                  {isWebmaster && (
                    <td className="px-6 py-4 text-right">
                      {u.role !== "webmaster" && u.uid !== profile?.uid ? (
                        <div className="flex items-center justify-end gap-2">
                          {u.role === "agent" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyUid === u.uid}
                              onClick={() => setRole(u, "admin")}
                              className="gap-1.5 h-8"
                            >
                              <ArrowUp className="h-3.5 w-3.5" /> Promote to admin
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyUid === u.uid}
                              onClick={() => setRole(u, "agent")}
                              className="gap-1.5 h-8"
                            >
                              <ArrowDown className="h-3.5 w-3.5" /> Set as agent
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                          <UserCog className="h-3.5 w-3.5" /> {u.uid === profile?.uid ? "You" : "—"}
                        </span>
                      )}
                    </td>
                  )}
                </motion.tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={isWebmaster ? 5 : 4} className="px-6 py-10 text-center text-sm text-muted-foreground">
                    No agents found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PullToRefresh>
  );
};

export default Agents;
