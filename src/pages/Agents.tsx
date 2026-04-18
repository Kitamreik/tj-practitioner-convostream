import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Search,
  ShieldCheck,
  UserCog,
  ArrowDown,
  ArrowUp,
  UserPlus,
  Copy,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import PullToRefresh from "@/components/PullToRefresh";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  addLocalAgent,
  removeLocalAgent,
  subscribeLocalAgents,
  type LocalAgent,
} from "@/lib/localAgents";
import { Trash2 } from "lucide-react";
import { logAgentCreated } from "@/lib/auditLog";

interface AgentRow {
  uid: string;
  email: string;
  displayName: string;
  role: "agent" | "admin" | "webmaster";
  escalatedAccess?: boolean;
  createdAt?: any;
  /** True when this row is a manually-added local agent (no Firestore doc). */
  isLocal?: boolean;
}

interface OpenConvo {
  id: string;
  status: "active" | "waiting" | "resolved";
  assignedAgent: string;
}

// Same threshold the Settings → Overview panel uses, so the two views agree.
const OVERLOAD_THRESHOLD = 3;

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

  // Live open conversations across the whole tenant so each agent row can
  // show their current load + an Overloaded badge without a Settings detour.
  const [openConvos, setOpenConvos] = useState<OpenConvo[]>([]);

  // Manually-added agents (localStorage). These are merged with the Firestore
  // users list so they show up in the roster + the assign-agent dropdown
  // even before they sign up. agent1/agent2 are seeded by default.
  const [localAgents, setLocalAgents] = useState<LocalAgent[]>([]);
  useEffect(() => subscribeLocalAgents(setLocalAgents), []);

  // ---- Manual add dialog (webmaster only) ----
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addName, setAddName] = useState("");

  // ---- Invite dialog (webmaster only) ----
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{
    actionLink: string;
    tempPassword: string | null;
    targetEmail: string;
    createdAuthUser: boolean;
  } | null>(null);

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

  useEffect(() => {
    // Open conversations live across the whole project. We filter to non-archived
    // and non-resolved client-side so the listener works for both webmasters
    // and agents (rules already allow signed-in users to read conversations).
    const unsub = onSnapshot(
      collection(db, "conversations"),
      (snap) => {
        const rows: OpenConvo[] = [];
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          if (data.archived) return;
          const status = (data.status ?? "active") as OpenConvo["status"];
          if (status === "resolved") return;
          rows.push({
            id: d.id,
            status,
            assignedAgent: (data.assignedAgent ?? "").trim(),
          });
        });
        setOpenConvos(rows);
      },
      (err) => {
        console.warn("Agents conversations listener error:", err);
        setOpenConvos([]);
      }
    );
    return unsub;
  }, []);

  const loadByAgent = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of openConvos) {
      if (!c.assignedAgent) continue;
      map.set(c.assignedAgent, (map.get(c.assignedAgent) ?? 0) + 1);
    }
    return map;
  }, [openConvos]);

  const getLoad = (u: AgentRow): number => {
    const name = (u.displayName || u.email || "").trim();
    return name ? loadByAgent.get(name) ?? 0 : 0;
  };

  // Merge Firestore users with manually-added local agents. Local entries are
  // suppressed when a Firestore user with the same email already exists, so
  // signing up later doesn't create a duplicate row.
  const merged = useMemo<AgentRow[]>(() => {
    const existingEmails = new Set(
      users.map((u) => (u.email || "").toLowerCase()).filter(Boolean)
    );
    const localRows: AgentRow[] = localAgents
      .filter((a) => !existingEmails.has(a.email.toLowerCase()))
      .map((a) => ({
        uid: a.id,
        email: a.email,
        displayName: a.displayName,
        role: "agent" as const,
        isLocal: true,
      }));
    return [...users, ...localRows];
  }, [users, localAgents]);

  const filtered = useMemo(
    () =>
      merged
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
    [merged, search]
  );

  const handleAddLocalAgent = () => {
    const res = addLocalAgent({ email: addEmail, displayName: addName });
    if (!res.ok) {
      toast({ title: "Could not add agent", description: res.reason, variant: "destructive" });
      return;
    }
    toast({
      title: "Agent added",
      description: `${res.agent!.displayName} is now available for assignment.`,
    });
    setAddEmail("");
    setAddName("");
    setAddOpen(false);
  };

  const handleRemoveLocalAgent = (row: AgentRow) => {
    removeLocalAgent(row.uid);
    toast({ title: "Agent removed", description: `${row.displayName} removed from local roster.` });
  };

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

  const handleInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      toast({ title: "Enter a valid email", variant: "destructive" });
      return;
    }
    setInviting(true);
    setInviteResult(null);
    try {
      const fn = httpsCallable<
        { targetEmail: string; displayName?: string; continueUrl?: string },
        {
          ok: boolean;
          targetUid: string;
          targetEmail: string;
          createdAuthUser: boolean;
          actionLink: string;
          tempPassword: string | null;
        }
      >(functions, "generateAgentSignupLink");
      const res = await fn({
        targetEmail: email,
        displayName: inviteName.trim() || undefined,
        continueUrl: `${window.location.origin}/login`,
      });
      setInviteResult({
        actionLink: res.data.actionLink,
        tempPassword: res.data.tempPassword,
        targetEmail: res.data.targetEmail,
        createdAuthUser: res.data.createdAuthUser,
      });
      toast({
        title: res.data.createdAuthUser ? "Invite created" : "Existing user — link generated",
        description: res.data.createdAuthUser
          ? `${email} added as agent. Share the link below.`
          : `${email} already exists. Share the verification link below.`,
      });
    } catch (e: any) {
      toast({
        title: "Could not create invite",
        description: e?.message || "Cloud Function unavailable.",
        variant: "destructive",
      });
    } finally {
      setInviting(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied to clipboard` });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const closeInviteDialog = () => {
    setInviteOpen(false);
    // Reset on next tick so the dialog close animation doesn't flash empty content.
    setTimeout(() => {
      setInviteEmail("");
      setInviteName("");
      setInviteResult(null);
    }, 200);
  };

  const handleRefresh = async () => {
    await new Promise((r) => setTimeout(r, 400));
    toast({ title: "Refreshed" });
  };

  const counts = useMemo(() => {
    const c = { agent: 0, admin: 0, webmaster: 0 };
    for (const u of merged) c[u.role]++;
    return c;
  }, [merged]);

  const renderLoadCell = (load: number) => {
    if (load === 0) return <span className="text-xs text-muted-foreground">Idle</span>;
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{load}</span>
        <span className="text-xs text-muted-foreground">open</span>
        {load >= OVERLOAD_THRESHOLD && (
          <Badge variant="destructive" className="gap-1 text-[10px]">
            <AlertTriangle className="h-3 w-3" /> Overloaded
          </Badge>
        )}
      </div>
    );
  };

  return (
    <PullToRefresh onRefresh={handleRefresh} disabled={!isMobile} className="h-full">
      <div className="p-4 md:p-8 max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-3 mb-6 md:mb-8">
          <div className="min-w-0">
            <h1 className="hidden md:block text-2xl font-bold text-foreground">Agents</h1>
            <p className="text-muted-foreground mt-1 text-sm md:text-base">
              Accounts assigned to handle customer conversations
            </p>
          </div>
          {isWebmaster && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddOpen(true)}
                className="gap-1.5"
                aria-label="Manually add an agent"
              >
                <UserPlus className="h-4 w-4" />
                <span className="hidden sm:inline">Add agent</span>
                <span className="sm:hidden">Add</span>
              </Button>
              <Button
                size="sm"
                onClick={() => setInviteOpen(true)}
                className="gap-1.5"
                aria-label="Send invite to a new agent"
              >
                <UserPlus className="h-4 w-4" />
                <span className="hidden sm:inline">Send invite</span>
                <span className="sm:hidden">Invite</span>
              </Button>
            </div>
          )}
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
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <Badge variant="secondary">{counts.agent} agents</Badge>
            <Badge>{counts.admin} admins</Badge>
            <Badge variant="outline">{counts.webmaster} webmasters</Badge>
          </div>
        </div>

        {error && (
          <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {error}
          </p>
        )}

        {/* Mobile cards */}
        <div className="md:hidden space-y-2">
          {filtered.map((u, i) => {
            const load = getLoad(u);
            return (
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
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Badge variant={roleVariant[u.role]} className="text-[10px]">
                          {roleLabel[u.role]}
                        </Badge>
                        {u.isLocal && (
                          <Badge variant="outline" className="text-[10px]">Local</Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{u.email || u.uid}</p>
                    <div className="mt-2">{renderLoadCell(load)}</div>
                    {isWebmaster && u.isLocal && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRemoveLocalAgent(u)}
                          className="gap-1.5 h-8"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Remove
                        </Button>
                      </div>
                    )}
                    {isWebmaster && !u.isLocal && u.role !== "webmaster" && u.uid !== profile?.uid && (
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
            );
          })}
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
                  Workload
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
              {filtered.map((u, i) => {
                const load = getLoad(u);
                return (
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
                      <div className="flex items-center gap-1.5">
                        <Badge variant={roleVariant[u.role]} className="text-xs">
                          {roleLabel[u.role]}
                        </Badge>
                        {u.isLocal && (
                          <Badge variant="outline" className="text-[10px]" title="Manually added — not yet signed up">
                            Local
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">{renderLoadCell(load)}</td>
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
                        {u.isLocal ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRemoveLocalAgent(u)}
                            className="gap-1.5 h-8"
                            aria-label={`Remove ${u.displayName}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Remove
                          </Button>
                        ) : u.role !== "webmaster" && u.uid !== profile?.uid ? (
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
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={isWebmaster ? 6 : 5} className="px-6 py-10 text-center text-sm text-muted-foreground">
                    No agents found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual add dialog (webmaster only). Persists locally so the agent
          shows up in the assign-agent dropdown immediately, without waiting
          for them to sign up or for a Cloud Function deploy. */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Add agent manually</DialogTitle>
            <DialogDescription>
              Adds an agent entry to the local roster (stored on this device).
              The agent becomes immediately available for assignment on conversations.
              When they later sign up with the same email, their Firestore profile
              takes over and the local entry is hidden automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="add-name">Display name</Label>
              <Input
                id="add-name"
                placeholder="Agent One"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-email">Email address</Label>
              <Input
                id="add-email"
                type="email"
                placeholder="agent@example.com"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddLocalAgent} className="gap-1.5">
              <UserPlus className="h-4 w-4" /> Add agent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite dialog (webmaster only) */}
      <Dialog open={inviteOpen} onOpenChange={(v) => (v ? setInviteOpen(true) : closeInviteDialog())}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Send agent invite</DialogTitle>
            <DialogDescription>
              Generates a Firebase signup link plus a one-time temporary password. Share both
              securely with the new agent — they'll verify their email and then change the
              password from Settings.
            </DialogDescription>
          </DialogHeader>

          {!inviteResult ? (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="invite-email">Email address</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="new.agent@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={inviting}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-name">Display name (optional)</Label>
                <Input
                  id="invite-name"
                  placeholder="Jane Doe"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  disabled={inviting}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                The new account will start with the <strong>agent</strong> role. You can promote
                them to admin afterwards from this page.
              </p>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <p className="font-medium">{inviteResult.targetEmail}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {inviteResult.createdAuthUser
                    ? "New account created with role = agent."
                    : "Account already existed — verification link refreshed."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Email verification link
                </Label>
                <div className="flex gap-2">
                  <Input readOnly value={inviteResult.actionLink} className="font-mono text-xs" />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => copyToClipboard(inviteResult.actionLink, "Link")}
                    aria-label="Copy link"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {inviteResult.tempPassword && (
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Temporary password
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={inviteResult.tempPassword}
                      className="font-mono text-xs"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() =>
                        copyToClipboard(inviteResult.tempPassword!, "Temporary password")
                      }
                      aria-label="Copy password"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Share this only via a secure channel. The agent should change it from Settings
                    on first login.
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            {!inviteResult ? (
              <>
                <Button variant="outline" onClick={closeInviteDialog} disabled={inviting}>
                  Cancel
                </Button>
                <Button onClick={handleInvite} disabled={inviting} className="gap-1.5">
                  {inviting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Generating…
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" /> Generate invite
                    </>
                  )}
                </Button>
              </>
            ) : (
              <Button onClick={closeInviteDialog}>Done</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PullToRefresh>
  );
};

export default Agents;
