import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Moon,
  Sun,
  User,
  Shield,
  KeyRound,
  Send,
  CheckCircle2,
  Clock,
  Users,
  Inbox,
  Trash2,
  Check,
  X,
  ShieldOff,
  Search,
  ExternalLink,
  Pencil,
  UserCog,
  History,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
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
import { toast } from "@/hooks/use-toast";
import { httpsCallable } from "firebase/functions";
import { functions, db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";

const ESCALATION_NOTIFY_EMAIL = "kit.tjclasses@gmail.com";

interface PendingEscalation {
  id: string;
  requesterUid: string;
  requesterEmail: string | null;
  requesterName: string | null;
  requesterRole: string;
  reason: string;
  emailSent: boolean;
  createdAt: any;
}

interface AccountRow {
  uid: string;
  email: string;
  displayName: string;
  role: "agent" | "admin" | "webmaster";
  escalatedAccess?: boolean;
  createdAt?: any;
}

interface InvestigationRow {
  id: string;
  conversationId: string;
  customerName: string;
  reason: string;
  requesterUid: string;
  requesterEmail: string | null;
  requesterName: string | null;
  status: string;
  emailSent: boolean;
  createdAt: any;
  resolvedAt?: any;
  resolutionNote?: string;
}

const SettingsPage: React.FC = () => {
  const { user, profile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isMobile = useIsMobile();

  // Resizable nav-pane width (desktop + webmaster only). Mirrors the pattern in
  // Conversations: persisted in localStorage, bounded to a sensible range.
  const NAV_WIDTH_KEY = "convohub.settings.navWidth";
  const [navWidth, setNavWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 240;
    const stored = Number(localStorage.getItem(NAV_WIDTH_KEY));
    return Number.isFinite(stored) && stored >= 180 && stored <= 420 ? stored : 240;
  });
  const navResizingRef = useRef(false);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!navResizingRef.current) return;
      const next = Math.min(420, Math.max(180, e.clientX));
      setNavWidth(next);
    };
    const onUp = () => {
      if (!navResizingRef.current) return;
      navResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { localStorage.setItem(NAV_WIDTH_KEY, String(navWidth)); } catch { /* noop */ }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [navWidth]);
  const startNavResize = (e: React.MouseEvent) => {
    e.preventDefault();
    navResizingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };


  // ---- Promote (webmaster only) ----
  const [promoteEmail, setPromoteEmail] = useState("");
  const [promoting, setPromoting] = useState(false);

  const handlePromote = async () => {
    const email = promoteEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      toast({ title: "Enter a valid email", variant: "destructive" });
      return;
    }
    setPromoting(true);
    try {
      const fn = httpsCallable<{ targetEmail: string; role: "webmaster" }, { ok: boolean; previousRole: string; newRole: string }>(
        functions,
        "promoteToWebmaster"
      );
      const res = await fn({ targetEmail: email, role: "webmaster" });
      toast({
        title: "Role granted",
        description: `${email} promoted ${res.data.previousRole} → ${res.data.newRole}.`,
      });
      setPromoteEmail("");
    } catch (e: any) {
      toast({
        title: "Promotion failed",
        description: e?.message || "Unable to grant role.",
        variant: "destructive",
      });
    } finally {
      setPromoting(false);
    }
  };

  // ---- Escalate (admin only) ----
  const [reason, setReason] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [latestRequest, setLatestRequest] = useState<{
    status: string;
    emailSent: boolean;
    createdAt: any;
  } | null>(null);

  // Subscribe to the user's most recent escalation request so they see status updates.
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "escalationRequests"),
      where("requesterUid", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(1)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setLatestRequest(null);
          return;
        }
        const d = snap.docs[0].data() as any;
        setLatestRequest({
          status: d.status || "pending",
          emailSent: !!d.emailSent,
          createdAt: d.createdAt,
        });
      },
      () => setLatestRequest(null)
    );
    return unsub;
  }, [user]);

  // Subscribe to the user's most recent revoke entry so they see why their
  // previous escalated access was removed (only relevant when they currently
  // do NOT have escalated access).
  const [latestRevoke, setLatestRevoke] = useState<{
    reason: string;
    grantedAt: any;
    grantedByEmail: string | null;
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "roleGrants"),
      where("targetUid", "==", user.uid),
      where("action", "==", "revokeEscalatedAccess"),
      orderBy("grantedAt", "desc"),
      limit(1)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setLatestRevoke(null);
          return;
        }
        const d = snap.docs[0].data() as any;
        setLatestRevoke({
          reason: d.reason || "",
          grantedAt: d.grantedAt,
          grantedByEmail: d.grantedByEmail ?? null,
        });
      },
      (err) => {
        console.warn("Latest revoke listener error:", err);
        setLatestRevoke(null);
      }
    );
    return unsub;
  }, [user]);

  const handleEscalate = async () => {
    setRequesting(true);
    try {
      const fn = httpsCallable<{ reason: string }, { ok: boolean; emailSent: boolean; emailError: string | null }>(
        functions,
        "requestWebmasterEscalation"
      );
      const res = await fn({ reason });
      if (res.data.emailSent) {
        toast({
          title: "Escalation requested",
          description: `Email sent to ${ESCALATION_NOTIFY_EMAIL}. A webmaster will review shortly.`,
        });
      } else {
        toast({
          title: "Request recorded",
          description: `Email delivery is not configured yet, but your request was logged for the webmaster.`,
        });
      }
      setReason("");
    } catch (e: any) {
      toast({
        title: "Could not submit request",
        description: e?.message || "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setRequesting(false);
    }
  };

  const isWebmaster = profile?.role === "webmaster";
  const hasEscalatedAccess = profile?.escalatedAccess === true;

  // ---- Pending escalation requests (webmaster only) ----
  const [pending, setPending] = useState<PendingEscalation[]>([]);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isWebmaster) return;
    const q = query(
      collection(db, "escalationRequests"),
      where("status", "==", "pending"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: PendingEscalation[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            requesterUid: data.requesterUid,
            requesterEmail: data.requesterEmail ?? null,
            requesterName: data.requesterName ?? null,
            requesterRole: data.requesterRole ?? "admin",
            reason: data.reason ?? "",
            emailSent: !!data.emailSent,
            createdAt: data.createdAt,
          };
        });
        setPending(rows);
      },
      (err) => {
        console.warn("Pending escalations listener error:", err);
        setPending([]);
      }
    );
    return unsub;
  }, [isWebmaster]);

  const decide = async (requestId: string, decision: "approve" | "deny") => {
    setDecidingId(requestId);
    try {
      const fn = httpsCallable<{ requestId: string; decision: "approve" | "deny" }, { ok: boolean; status: string }>(
        functions,
        "decideEscalationRequest"
      );
      const res = await fn({ requestId, decision });
      toast({
        title: decision === "approve" ? "Request approved" : "Request denied",
        description:
          decision === "approve"
            ? "User now has escalated access to Integrations, Analytics, and Gmail API."
            : `Request ${res.data.status}.`,
      });
    } catch (e: any) {
      toast({ title: "Could not update request", description: e?.message, variant: "destructive" });
    } finally {
      setDecidingId(null);
    }
  };

  // ---- All accounts (webmaster only) ----
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);

  useEffect(() => {
    if (!isWebmaster) return;
    const unsub = onSnapshot(
      query(collection(db, "users"), orderBy("createdAt", "desc")),
      (snap) => {
        const rows: AccountRow[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            uid: d.id,
            email: data.email ?? "",
            displayName: data.displayName ?? "",
            role: data.role ?? "admin",
            escalatedAccess: !!data.escalatedAccess,
            createdAt: data.createdAt,
          };
        });
        setAccounts(rows);
      },
      (err) => {
        console.warn("Accounts listener error:", err);
        setAccounts([]);
      }
    );
    return unsub;
  }, [isWebmaster]);

  const deleteAccount = async (uid: string, email: string) => {
    setDeletingUid(uid);
    try {
      const fn = httpsCallable<{ targetUid: string }, { ok: boolean }>(functions, "deleteUserAccount");
      await fn({ targetUid: uid });
      toast({ title: "Account deleted", description: `${email || uid} removed from Auth + Firestore.` });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    } finally {
      setDeletingUid(null);
    }
  };

  // ---- Revoke escalated access (webmaster only) ----
  const [revokingUid, setRevokingUid] = useState<string | null>(null);
  const [revokeDialogUid, setRevokeDialogUid] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const revokeEscalation = async (uid: string, email: string) => {
    const reason = revokeReason.trim();
    if (!reason) {
      toast({ title: "Reason required", description: "Please describe why you're revoking access.", variant: "destructive" });
      return;
    }
    setRevokingUid(uid);
    try {
      const fn = httpsCallable<{ targetUid: string; reason: string }, { ok: boolean }>(functions, "revokeEscalatedAccess");
      await fn({ targetUid: uid, reason });
      toast({ title: "Escalated access revoked", description: `${email || uid} no longer has expanded access.` });
      setRevokeDialogUid(null);
      setRevokeReason("");
    } catch (e: any) {
      toast({ title: "Revoke failed", description: e?.message, variant: "destructive" });
    } finally {
      setRevokingUid(null);
    }
  };

  // ---- Rename agent (webmaster only) ----
  const [renameUid, setRenameUid] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [agentSearch, setAgentSearch] = useState("");

  const openRename = (acc: AccountRow) => {
    setRenameUid(acc.uid);
    setRenameValue(acc.displayName || "");
  };

  const submitRename = async () => {
    if (!renameUid) return;
    const value = renameValue.trim();
    if (!value) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (value.length > 80) {
      toast({ title: "Name too long", description: "Max 80 characters.", variant: "destructive" });
      return;
    }
    setRenaming(true);
    try {
      const fn = httpsCallable<{ targetUid: string; displayName: string }, { ok: boolean }>(
        functions,
        "updateAgentDisplayName"
      );
      await fn({ targetUid: renameUid, displayName: value });
      toast({ title: "Agent renamed", description: `Display name updated to "${value}".` });
      setRenameUid(null);
      setRenameValue("");
    } catch (e: any) {
      toast({ title: "Rename failed", description: e?.message, variant: "destructive" });
    } finally {
      setRenaming(false);
    }
  };

  // ---- Promote agent → admin / Demote admin → agent (webmaster only) ----
  const [roleChangingUid, setRoleChangingUid] = useState<string | null>(null);

  const promoteAgentToAdmin = async (acc: AccountRow) => {
    if (!acc.email) {
      toast({ title: "No email on account", description: "Cannot promote without an email.", variant: "destructive" });
      return;
    }
    setRoleChangingUid(acc.uid);
    try {
      const fn = httpsCallable<{ targetEmail: string; role: "admin" }, { ok: boolean; previousRole: string; newRole: string }>(
        functions,
        "promoteToWebmaster"
      );
      const res = await fn({ targetEmail: acc.email, role: "admin" });
      toast({
        title: "Promoted to admin",
        description: `${acc.email} ${res.data.previousRole} → ${res.data.newRole}.`,
      });
    } catch (e: any) {
      toast({ title: "Promote failed", description: e?.message || "Unable to promote.", variant: "destructive" });
    } finally {
      setRoleChangingUid(null);
    }
  };

  const demoteToAgent = async (acc: AccountRow) => {
    setRoleChangingUid(acc.uid);
    try {
      const fn = httpsCallable<{ targetUid: string; reason?: string }, { ok: boolean; previousRole?: string; newRole?: string }>(
        functions,
        "demoteAgent"
      );
      await fn({ targetUid: acc.uid });
      toast({ title: "Demoted to agent", description: `${acc.email || acc.uid} is now an agent.` });
    } catch (e: any) {
      toast({ title: "Demote failed", description: e?.message || "Unable to demote.", variant: "destructive" });
    } finally {
      setRoleChangingUid(null);
    }
  };

  // ---- Rename history (webmaster only) ----
  // Subscribe to recent renameAgent entries from `roleGrants` and group by targetUid
  // so each agent row can show its most recent renames inline.
  interface RenameEvent {
    id: string;
    targetUid: string;
    previousDisplayName: string;
    newDisplayName: string;
    grantedByEmail: string | null;
    grantedAt: any;
  }
  const [renameEvents, setRenameEvents] = useState<RenameEvent[]>([]);
  useEffect(() => {
    if (!isWebmaster) return;
    const q = query(
      collection(db, "roleGrants"),
      where("action", "==", "renameAgent"),
      orderBy("grantedAt", "desc"),
      limit(100)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: RenameEvent[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            targetUid: data.targetUid ?? "",
            previousDisplayName: data.previousDisplayName ?? "",
            newDisplayName: data.newDisplayName ?? "",
            grantedByEmail: data.grantedByEmail ?? null,
            grantedAt: data.grantedAt,
          };
        });
        setRenameEvents(rows);
      },
      (err) => {
        console.warn("Rename history listener error:", err);
        setRenameEvents([]);
      }
    );
    return unsub;
  }, [isWebmaster]);

  const renamesByUid = useMemo(() => {
    const map = new Map<string, RenameEvent[]>();
    for (const ev of renameEvents) {
      if (!ev.targetUid) continue;
      const arr = map.get(ev.targetUid) ?? [];
      arr.push(ev);
      map.set(ev.targetUid, arr);
    }
    return map;
  }, [renameEvents]);

  // Track which agent rows have rename-history expanded (collapsed by default).
  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set());
  const toggleHistory = (uid: string) => {
    setOpenHistory((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  // Agents = anyone whose role is "agent" (the new baseline) OR legacy "admin".
  // Webmasters are excluded — they manage themselves via the Accounts panel.
  const agentRows = accounts.filter(
    (a) => (a.role === "agent" || a.role === "admin") &&
      (agentSearch.trim() === "" ||
        (a.displayName || "").toLowerCase().includes(agentSearch.toLowerCase()) ||
        (a.email || "").toLowerCase().includes(agentSearch.toLowerCase()))
  );

  // ---- Investigation requests (webmaster only) ----
  const [investigations, setInvestigations] = useState<InvestigationRow[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isWebmaster) return;
    const unsub = onSnapshot(
      query(collection(db, "investigationRequests"), orderBy("createdAt", "desc"), limit(50)),
      (snap) => {
        const rows: InvestigationRow[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            conversationId: data.conversationId ?? "",
            customerName: data.customerName ?? "",
            reason: data.reason ?? "",
            requesterUid: data.requesterUid ?? "",
            requesterEmail: data.requesterEmail ?? null,
            requesterName: data.requesterName ?? null,
            status: data.status ?? "open",
            emailSent: !!data.emailSent,
            createdAt: data.createdAt,
            resolvedAt: data.resolvedAt,
            resolutionNote: data.resolutionNote,
          };
        });
        setInvestigations(rows);
      },
      (err) => {
        console.warn("Investigation requests listener error:", err);
        setInvestigations([]);
      }
    );
    return unsub;
  }, [isWebmaster]);

  const resolveInvestigation = async (id: string) => {
    setResolvingId(id);
    try {
      const fn = httpsCallable<{ requestId: string }, { ok: boolean }>(functions, "resolveInvestigationRequest");
      await fn({ requestId: id });
      toast({ title: "Investigation resolved" });
    } catch (e: any) {
      toast({ title: "Could not resolve", description: e?.message, variant: "destructive" });
    } finally {
      setResolvingId(null);
    }
  };

  const visibleInvestigations = showResolved
    ? investigations
    : investigations.filter((i) => i.status !== "resolved");

  const formatTime = (ts: any) => {
    try {
      if (ts?.toDate) return ts.toDate().toLocaleString();
    } catch { /* noop */ }
    return "—";
  };

  const navSections: { id: string; label: string }[] = [
    { id: "profile", label: "Profile" },
    { id: "appearance", label: "Appearance" },
    ...(isWebmaster
      ? [
          { id: "promote", label: "Promote to Webmaster" },
          { id: "pending", label: "Pending escalations" },
          { id: "agents", label: "Agents" },
          { id: "accounts", label: "Accounts" },
          { id: "investigations", label: "Investigation requests" },
        ]
      : [{ id: "escalate", label: "Escalate to Webmaster" }]),
    { id: "security", label: "Security" },
  ];
  const showSideNav = isWebmaster && !isMobile;

  return (
    <div className={cn(
      "mx-auto",
      showSideNav ? "flex h-full max-w-6xl gap-0 p-0" : `p-4 md:p-8 ${isWebmaster ? "max-w-4xl" : "max-w-2xl"}`
    )}>
      {showSideNav && (
        <>
          <aside
            className="flex flex-col border-r border-border bg-card/40 p-4 overflow-y-auto"
            style={{ width: `${navWidth}px`, flex: "0 0 auto" }}
            aria-label="Settings sections"
          >
            <h2 className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Settings
            </h2>
            <nav className="flex flex-col gap-1">
              {navSections.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  {s.label}
                </a>
              ))}
            </nav>
          </aside>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize settings navigation"
            onMouseDown={startNavResize}
            className="group relative w-1 cursor-col-resize bg-transparent hover:bg-primary/20 active:bg-primary/30 transition-colors"
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover:bg-primary/40" />
          </div>
        </>
      )}
      <div className={cn(showSideNav ? "flex-1 min-w-0 overflow-y-auto p-6 md:p-8" : "")}>
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and preferences</p>
      </div>

      <div className="space-y-6 md:space-y-8">
        {/* Profile */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-4">
            <User className="h-5 w-5 text-primary" />
            Profile
          </h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input value={profile?.displayName || ""} readOnly className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={profile?.email || ""} readOnly className="bg-muted" />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Label>Role</Label>
              <Badge variant="secondary" className="capitalize">{profile?.role}</Badge>
              {hasEscalatedAccess && !isWebmaster && (
                <Badge variant="outline" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Escalated access
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-4">
            {theme === "light" ? <Sun className="h-5 w-5 text-primary" /> : <Moon className="h-5 w-5 text-primary" />}
            Appearance
          </h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Theme</p>
              <p className="text-xs text-muted-foreground">Switch between light and dark mode</p>
            </div>
            <Button variant="outline" onClick={toggleTheme} className="gap-2">
              {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              {theme === "light" ? "Dark" : "Light"}
            </Button>
          </div>
        </div>

        {/* Webmaster-only: Promote */}
        {isWebmaster && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-1">
              <KeyRound className="h-5 w-5 text-primary" />
              Promote to Webmaster
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Grants the target account full webmaster access. The change is recorded in
              <code className="mx-1 rounded bg-muted px-1 py-0.5">roleGrants</code>
              and signed server-side via the <code className="mx-1 rounded bg-muted px-1 py-0.5">_serverRoleWrite</code> sentinel.
            </p>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="promote-email">Target user email</Label>
                <Input
                  id="promote-email"
                  type="email"
                  placeholder="user@example.com"
                  value={promoteEmail}
                  onChange={(e) => setPromoteEmail(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <Button onClick={handlePromote} disabled={promoting || !promoteEmail.trim()} className="gap-2">
                <KeyRound className="h-4 w-4" />
                {promoting ? "Granting…" : "Grant webmaster role"}
              </Button>
            </div>
          </div>
        )}

        {/* Webmaster-only: Pending escalation requests */}
        {isWebmaster && (
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-1">
              <Inbox className="h-5 w-5 text-primary" />
              Pending escalation requests
              {pending.length > 0 && (
                <Badge variant="secondary" className="ml-1">{pending.length}</Badge>
              )}
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Approve to grant the user escalated access to Integrations, Analytics, and Gmail API.
              Both decisions are written to <code className="rounded bg-muted px-1 py-0.5">escalationRequests</code>.
            </p>
            {pending.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No pending requests.
              </div>
            ) : (
              <div className="space-y-2">
                {pending.map((req) => (
                  <div
                    key={req.id}
                    className="rounded-lg border border-border bg-background p-3 flex flex-col sm:flex-row gap-3 sm:items-center"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {req.requesterName || req.requesterEmail || req.requesterUid}
                        </span>
                        <Badge variant="outline" className="capitalize text-[10px]">{req.requesterRole}</Badge>
                        {req.emailSent && (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <Send className="h-2.5 w-2.5" /> Email sent
                          </Badge>
                        )}
                      </div>
                      {req.requesterEmail && req.requesterName && (
                        <p className="text-xs text-muted-foreground truncate">{req.requesterEmail}</p>
                      )}
                      {req.reason && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">"{req.reason}"</p>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-1">{formatTime(req.createdAt)}</p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        disabled={decidingId === req.id}
                        onClick={() => decide(req.id, "deny")}
                      >
                        <X className="h-3.5 w-3.5" /> Deny
                      </Button>
                      <Button
                        size="sm"
                        className="gap-1"
                        disabled={decidingId === req.id}
                        onClick={() => decide(req.id, "approve")}
                      >
                        <Check className="h-3.5 w-3.5" />
                        {decidingId === req.id ? "…" : "Approve"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Webmaster-only: Agents (rename agents) */}
        {isWebmaster && (
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground">
                <UserCog className="h-5 w-5 text-primary" />
                Agents
                <Badge variant="secondary" className="ml-1">{agentRows.length}</Badge>
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Every signed-up account is registered as an <strong>agent</strong>. Rename them here so
              their display name is consistent across conversations and assignments. Renames are
              audited in <code className="rounded bg-muted px-1 py-0.5">roleGrants</code>.
            </p>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search agents by name or email..."
                className="pl-9"
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              {agentRows.map((acc) => {
                const history = renamesByUid.get(acc.uid) ?? [];
                const isOpen = openHistory.has(acc.uid);
                const isAdminTier = acc.role === "admin";
                const busy = roleChangingUid === acc.uid;
                return (
                  <div
                    key={acc.uid}
                    className="rounded-lg border border-border bg-background p-3"
                  >
                    <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                        {(acc.displayName || acc.email || "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground truncate">
                            {acc.displayName || "(no name)"}
                          </span>
                          <Badge variant="secondary" className="capitalize text-[10px]">{acc.role}</Badge>
                          {acc.escalatedAccess && (
                            <Badge variant="outline" className="text-[10px] gap-1">
                              <CheckCircle2 className="h-2.5 w-2.5" /> Escalated
                            </Badge>
                          )}
                          {history.length > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleHistory(acc.uid)}
                              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                              aria-expanded={isOpen}
                            >
                              <History className="h-3 w-3" />
                              {history.length} rename{history.length === 1 ? "" : "s"}
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{acc.email || acc.uid}</p>
                      </div>
                      <div className="flex flex-shrink-0 flex-wrap gap-2">
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => openRename(acc)}>
                          <Pencil className="h-3.5 w-3.5" />
                          Rename
                        </Button>
                        {isAdminTier ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            disabled={busy}
                            onClick={() => demoteToAgent(acc)}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                            {busy ? "…" : "Demote to agent"}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            disabled={busy}
                            onClick={() => promoteAgentToAdmin(acc)}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                            {busy ? "…" : "Promote to admin"}
                          </Button>
                        )}
                      </div>
                    </div>
                    {isOpen && history.length > 0 && (
                      <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                        {history.slice(0, 5).map((ev) => (
                          <li
                            key={ev.id}
                            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground"
                          >
                            <span className="line-through opacity-70">
                              {ev.previousDisplayName || "(blank)"}
                            </span>
                            <span aria-hidden>→</span>
                            <span className="font-medium text-foreground">
                              {ev.newDisplayName || "(blank)"}
                            </span>
                            <span className="opacity-70">
                              · by {ev.grantedByEmail || "webmaster"} · {formatTime(ev.grantedAt)}
                            </span>
                          </li>
                        ))}
                        {history.length > 5 && (
                          <li className="text-[10px] text-muted-foreground italic">
                            + {history.length - 5} older rename{history.length - 5 === 1 ? "" : "s"} (see Audit Logs)
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                );
              })}
              {agentRows.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  {agentSearch ? "No agents match your search." : "No agents yet."}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Shared rename-agent dialog (controlled) */}
        {isWebmaster && (
          <Dialog
            open={!!renameUid}
            onOpenChange={(o) => {
              if (!o) {
                setRenameUid(null);
                setRenameValue("");
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rename agent</DialogTitle>
                <DialogDescription>
                  Update the display name shown across the app for this agent. The previous and new
                  names are recorded in <code className="rounded bg-muted px-1 py-0.5 text-xs">roleGrants</code>.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="rename-agent-input">Display name</Label>
                <Input
                  id="rename-agent-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  placeholder="Jane Smith"
                  maxLength={80}
                  autoFocus
                />
                <p className="text-[10px] text-muted-foreground text-right">{renameValue.length}/80</p>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRenameUid(null);
                    setRenameValue("");
                  }}
                >
                  Cancel
                </Button>
                <Button disabled={!renameValue.trim() || renaming} onClick={submitRename}>
                  {renaming ? "Saving…" : "Save name"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Webmaster-only: All accounts */}
        {isWebmaster && (
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-1">
              <Users className="h-5 w-5 text-primary" />
              Accounts
              <Badge variant="secondary" className="ml-1">{accounts.length}</Badge>
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Every account in the system. Deletion removes the user from Firebase Auth and Firestore — it cannot be undone.
              Each deletion is written to <code className="rounded bg-muted px-1 py-0.5">accountDeletions</code>.
            </p>
            <div className="space-y-2">
              {accounts.map((acc) => {
                const isSelf = acc.uid === user?.uid;
                return (
                  <div
                    key={acc.uid}
                    className="rounded-lg border border-border bg-background p-3 flex flex-col sm:flex-row gap-3 sm:items-center"
                  >
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {(acc.displayName || acc.email || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {acc.displayName || "(no name)"}
                        </span>
                        <Badge variant="secondary" className="capitalize text-[10px]">{acc.role}</Badge>
                        {acc.escalatedAccess && acc.role !== "webmaster" && (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <CheckCircle2 className="h-2.5 w-2.5" /> Escalated
                          </Badge>
                        )}
                        {isSelf && <Badge variant="outline" className="text-[10px]">You</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{acc.email || acc.uid}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Joined {formatTime(acc.createdAt)}</p>
                    </div>
                    <div className="flex flex-shrink-0 gap-2 flex-wrap">
                      {acc.escalatedAccess && acc.role !== "webmaster" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          disabled={revokingUid === acc.uid}
                          onClick={() => {
                            setRevokeReason("");
                            setRevokeDialogUid(acc.uid);
                          }}
                        >
                          <ShieldOff className="h-3.5 w-3.5" />
                          {revokingUid === acc.uid ? "Revoking…" : "Revoke escalation"}
                        </Button>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 text-destructive hover:text-destructive"
                            disabled={isSelf || deletingUid === acc.uid}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {deletingUid === acc.uid ? "Deleting…" : "Delete"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this account?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently removes {acc.email || acc.displayName || acc.uid} from
                              Firebase Auth and Firestore. They will lose access immediately and cannot sign in again.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => deleteAccount(acc.uid, acc.email)}
                            >
                              Delete account
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                );
              })}
              {accounts.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No accounts yet.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Shared revoke-escalation dialog (controlled) */}
        {isWebmaster && (
          <Dialog
            open={!!revokeDialogUid}
            onOpenChange={(o) => {
              if (!o) {
                setRevokeDialogUid(null);
                setRevokeReason("");
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Revoke escalated access?</DialogTitle>
                <DialogDescription>
                  {(() => {
                    const target = accounts.find((a) => a.uid === revokeDialogUid);
                    const who = target?.email || target?.displayName || target?.uid || "this user";
                    return `${who} will lose access to Integrations, Analytics, and the Gmail API. They can request escalation again later. This action and your reason are recorded in roleGrants.`;
                  })()}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="revoke-reason">Reason for revoking <span className="text-destructive">*</span></Label>
                <Textarea
                  id="revoke-reason"
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder="e.g. Investigation closed, no longer needs Gmail API access."
                  rows={4}
                  maxLength={1000}
                  autoFocus
                />
                <p className="text-[10px] text-muted-foreground text-right">{revokeReason.length}/1000</p>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRevokeDialogUid(null);
                    setRevokeReason("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  disabled={!revokeReason.trim() || !!revokingUid}
                  onClick={() => {
                    const target = accounts.find((a) => a.uid === revokeDialogUid);
                    if (target) revokeEscalation(target.uid, target.email);
                  }}
                >
                  {revokingUid ? "Revoking…" : "Revoke access"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Webmaster-only: Investigation requests */}
        {isWebmaster && (
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground">
                <Search className="h-5 w-5 text-primary" />
                Investigation requests
                {visibleInvestigations.length > 0 && (
                  <Badge variant="secondary" className="ml-1">{visibleInvestigations.length}</Badge>
                )}
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowResolved((v) => !v)}
              >
                {showResolved ? "Hide resolved" : "Show resolved"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Conversations flagged by admins for webmaster review. Each entry is also emailed to
              {" "}<code className="rounded bg-muted px-1 py-0.5">{ESCALATION_NOTIFY_EMAIL}</code>.
            </p>
            {visibleInvestigations.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {showResolved ? "No investigation requests yet." : "No open investigation requests."}
              </div>
            ) : (
              <div className="space-y-2">
                {visibleInvestigations.map((inv) => (
                  <div
                    key={inv.id}
                    className="rounded-lg border border-border bg-background p-3 flex flex-col sm:flex-row gap-3 sm:items-center"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {inv.customerName || "(unnamed conversation)"}
                        </span>
                        <Badge
                          variant={inv.status === "resolved" ? "outline" : "secondary"}
                          className="capitalize text-[10px]"
                        >
                          {inv.status}
                        </Badge>
                        {inv.emailSent && (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <Send className="h-2.5 w-2.5" /> Email sent
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        Requested by {inv.requesterName || inv.requesterEmail || inv.requesterUid}
                      </p>
                      {inv.reason && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">"{inv.reason}"</p>
                      )}
                      <div className="flex flex-wrap items-center gap-3 mt-1">
                        <p className="text-[10px] text-muted-foreground">{formatTime(inv.createdAt)}</p>
                        {inv.conversationId && (
                          <Link
                            to={`/conversations?open=${encodeURIComponent(inv.conversationId)}`}
                            className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                          >
                            <ExternalLink className="h-2.5 w-2.5" />
                            Open conversation
                          </Link>
                        )}
                      </div>
                      {inv.status === "resolved" && inv.resolutionNote && (
                        <p className="text-[10px] text-muted-foreground mt-1 italic">
                          Resolved: {inv.resolutionNote}
                        </p>
                      )}
                    </div>
                    {inv.status !== "resolved" && (
                      <div className="flex-shrink-0">
                        <Button
                          size="sm"
                          className="gap-1"
                          disabled={resolvingId === inv.id}
                          onClick={() => resolveInvestigation(inv.id)}
                        >
                          <Check className="h-3.5 w-3.5" />
                          {resolvingId === inv.id ? "…" : "Resolve"}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Admin-only: Escalate */}
        {!isWebmaster && (
          <div className="rounded-xl border border-accent/40 bg-accent/5 p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-1">
              <Shield className="h-5 w-5 text-primary" />
              Escalate to Webmaster
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              {hasEscalatedAccess
                ? `You currently have escalated access to Integrations, Analytics, and the Gmail API. A webmaster can revoke this at any time.`
                : `Your admin account doesn't have access to Integrations, Analytics, or the Gmail API. Request escalation to notify a webmaster (${ESCALATION_NOTIFY_EMAIL}).`}
            </p>

            {latestRevoke && !hasEscalatedAccess && (
              <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <ShieldOff className="h-3.5 w-3.5 text-destructive" />
                  Your previous escalated access was revoked
                </div>
                <p className="mt-1 text-muted-foreground">
                  <span className="italic">"{latestRevoke.reason || "(no reason recorded)"}"</span>
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {latestRevoke.grantedByEmail ? `By ${latestRevoke.grantedByEmail} · ` : ""}
                  {formatTime(latestRevoke.grantedAt)}
                </p>
              </div>
            )}

            {!hasEscalatedAccess && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="escalate-reason">Reason (optional)</Label>
                  <Textarea
                    id="escalate-reason"
                    placeholder="Why do you need access to Integrations / Analytics / Gmail?"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    maxLength={500}
                  />
                </div>
                <Button onClick={handleEscalate} disabled={requesting} className="gap-2">
                  <Send className="h-4 w-4" />
                  {requesting ? "Sending…" : "Request escalation"}
                </Button>
              </div>
            )}

            {latestRequest && !hasEscalatedAccess && (
              <div className="mt-4 rounded-lg border border-border bg-card p-3 text-xs">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  Last request: <span className="capitalize">{latestRequest.status}</span>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {latestRequest.emailSent
                    ? `Notification email delivered to ${ESCALATION_NOTIFY_EMAIL}.`
                    : `Request logged. Email will go out once SMTP is configured on the Cloud Function.`}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Security */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-4">
            <Shield className="h-5 w-5 text-primary" />
            Security
          </h3>
          <p className="text-sm text-muted-foreground">
            Authentication is managed via Firebase. Use the Firebase Console to reset your password or enable MFA.
            Role changes are server-enforced — the <code className="rounded bg-muted px-1 py-0.5">enforceUserRoleOnWrite</code> trigger
            reverts any client-side tampering.
          </p>
        </div>
      </div>
      </div>
    </div>
  );
};

export default SettingsPage;
