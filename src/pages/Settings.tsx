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
  LayoutDashboard,
  MessageCircle,
  ArrowRightLeft,
  Eye,
  EyeOff,
  Copy,
  PhoneCall,
  Mail,
  LifeBuoy,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { getBoolPref, setBoolPrefRemote, subscribeBoolPrefRemote } from "@/lib/userPrefs";
import { BG_GMAIL_INGEST_PREF } from "@/hooks/useBackgroundGmailPoller";
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
import { subscribeLocalAgents, type LocalAgent } from "@/lib/localAgents";
import {
  setLocalManagedPassword,
  getLocalManagedPassword,
} from "@/lib/managedPasswords";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  doc,
  writeBatch,
  getDocs,
} from "firebase/firestore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COOLDOWN_OPTIONS_MIN,
  DEFAULT_COOLDOWN_MIN,
  setCooldownMin,
  subscribeCooldownMin,
  subscribeSlackAlertConfigured,
  setSlackWebhookUrl,
  type CooldownMinutes,
} from "@/lib/webmasterCooldown";
import {
  subscribeRecentContactEvents,
  type WebmasterContactEvent,
} from "@/lib/webmasterContactEvents";

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
  const { theme, toggleTheme, setTheme } = useTheme();
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

  // ---- Provision Support (webmaster only) ----
  // One-click flow that grants webmaster role to support@convohub.dev AND
  // clones the calling webmaster's integrations + UI prefs into that account
  // via the `cloneIntegrationsToSupport` callable. The Support account must
  // already exist (sign up via /login first).
  const SUPPORT_EMAIL = "support@convohub.dev";
  const [provisioningSupport, setProvisioningSupport] = useState(false);
  const supportAccount = useMemo(
    () => accounts.find((a) => a.email.trim().toLowerCase() === SUPPORT_EMAIL),
    [/* set after accounts is declared; see below */]
  );

  const handleProvisionSupport = async () => {
    setProvisioningSupport(true);
    try {
      // 1) Promote to webmaster (idempotent — re-promoting is a no-op).
      const promoteFn = httpsCallable<
        { targetEmail: string; role: "webmaster" },
        { ok: boolean; previousRole: string; newRole: string }
      >(functions, "promoteToWebmaster");
      const promoteRes = await promoteFn({ targetEmail: SUPPORT_EMAIL, role: "webmaster" });

      // 2) Clone integrations + UI prefs from the caller into Support's uid.
      const cloneFn = httpsCallable<
        { targetEmail: string },
        { ok: boolean; clonedIntegrations: boolean; clonedPrefs: boolean }
      >(functions, "cloneIntegrationsToSupport");
      const cloneRes = await cloneFn({ targetEmail: SUPPORT_EMAIL });

      const parts: string[] = [];
      parts.push(`Role ${promoteRes.data.previousRole} → ${promoteRes.data.newRole}`);
      parts.push(cloneRes.data.clonedIntegrations ? "integrations cloned" : "no integrations to clone");
      parts.push(cloneRes.data.clonedPrefs ? "prefs cloned" : "no prefs to clone");
      toast({
        title: "Support account provisioned",
        description: parts.join(" · "),
      });
    } catch (e: any) {
      const msg = e?.message || "Unable to provision Support account.";
      toast({
        title: "Provisioning failed",
        description: msg.includes("No user with email")
          ? `Sign up ${SUPPORT_EMAIL} first via the login page, then retry.`
          : msg,
        variant: "destructive",
      });
    } finally {
      setProvisioningSupport(false);
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

  // ---- Background Gmail ingestion toggle (webmaster only) ----
  // Stored at users/{uid}/prefs/ui (Firestore) so the choice follows the
  // webmaster across devices, mirrored to localStorage for instant reads.
  const [bgGmailEnabled, setBgGmailEnabled] = useState<boolean>(() =>
    getBoolPref(profile?.uid, BG_GMAIL_INGEST_PREF, false)
  );
  useEffect(() => {
    setBgGmailEnabled(getBoolPref(profile?.uid, BG_GMAIL_INGEST_PREF, false));
    return subscribeBoolPrefRemote(profile?.uid, BG_GMAIL_INGEST_PREF, setBgGmailEnabled, false);
  }, [profile?.uid]);
  const handleToggleBgGmail = (next: boolean) => {
    setBgGmailEnabled(next);
    // Local mirror is written synchronously inside setBoolPrefRemote so the
    // UI reflects the change instantly while the Firestore write completes.
    void setBoolPrefRemote(profile?.uid, BG_GMAIL_INGEST_PREF, next);
    toast({
      title: next ? "Background Gmail ingestion ON" : "Background Gmail ingestion paused",
      description: next
        ? "New INBOX messages will appear in Conversations within ~2 minutes. Synced across your devices."
        : "Polling stopped on every device. Re-enable any time — Google consent is preserved.",
    });
  };

  // ---- Webmaster contact cooldown (team-wide setting) ----
  const [cooldownMin, setCooldownMinState] = useState<CooldownMinutes>(DEFAULT_COOLDOWN_MIN);
  const [savingCooldown, setSavingCooldown] = useState(false);
  useEffect(() => subscribeCooldownMin(setCooldownMinState), []);

  // ---- Slack webhook (team-wide; admin/webmaster). The URL itself never
  //      reaches the browser anymore — we only know whether one is set via
  //      the public `appSettings/slackAlertStatus.configured` mirror. The
  //      input field is a write-only "paste a new URL" control.
  const isAdmin = profile?.role === "admin";
  const canEditWebhook = isWebmaster || isAdmin;
  const [slackConfigured, setSlackConfigured] = useState<boolean>(false);
  const [slackWebhookDraft, setSlackWebhookDraft] = useState<string>("");
  const [savingSlackWebhook, setSavingSlackWebhook] = useState(false);
  useEffect(() => subscribeSlackAlertConfigured(setSlackConfigured), []);
  const handleSaveSlackWebhook = async () => {
    setSavingSlackWebhook(true);
    try {
      const res = await setSlackWebhookUrl(slackWebhookDraft);
      toast({
        title: res.configured ? "Slack webhook saved" : "Slack webhook cleared",
        description: res.configured
          ? "Stored server-side. Ping Slack alerts are now active."
          : "Slack alerts disabled — bell notifications still fire.",
      });
      setSlackWebhookDraft("");
    } catch (e: any) {
      toast({
        title: "Could not save webhook",
        description: e?.message || "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSavingSlackWebhook(false);
    }
  };

  // The legacy "Send test ping" was removed when the webhook moved
  // server-side — the URL is no longer in the browser to test against.
  // Use the "Ping Slack" button on /conversations to verify end-to-end.

  const handleCooldownChange = async (value: string) => {
    const n = Number(value) as CooldownMinutes;
    setSavingCooldown(true);
    try {
      await setCooldownMin(n, profile?.uid);
      toast({
        title: "Cooldown updated",
        description: `Agents must now wait ${n} min between webmaster contacts.`,
      });
    } catch (e: any) {
      toast({
        title: "Could not save cooldown",
        description: e?.message || "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSavingCooldown(false);
    }
  };

  // ---- Recent webmaster-contact events (webmaster only) ----
  // Drives the small history list under the cooldown section so the on-call
  // webmaster can spot patterns at a glance.
  const [recentContacts, setRecentContacts] = useState<WebmasterContactEvent[]>([]);
  useEffect(() => {
    if (!isWebmaster) return;
    return subscribeRecentContactEvents(10, setRecentContacts);
  }, [isWebmaster]);

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

  // Manually-added local agents (webmaster's localStorage). Merged into the
  // Reassign target list so reassignment can target an agent that hasn't
  // signed up yet (e.g. agent1@convohub.dev seeded by default).
  const [localAgents, setLocalAgents] = useState<LocalAgent[]>([]);
  useEffect(() => subscribeLocalAgents(setLocalAgents), []);

  // ---- Overview: live conversations grouped by assigned agent (webmaster only) ----
  interface OverviewConvo {
    id: string;
    customerName: string;
    status: "active" | "waiting" | "resolved";
    channel: string;
    assignedAgent: string;
    archived?: boolean;
    timestamp?: any;
    unread?: boolean;
  }
  const [overviewConvos, setOverviewConvos] = useState<OverviewConvo[]>([]);
  useEffect(() => {
    if (!isWebmaster) return;
    const unsub = onSnapshot(
      query(collection(db, "conversations"), orderBy("timestamp", "desc")),
      (snap) => {
        const rows: OverviewConvo[] = snap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              customerName: data.customerName ?? "(no name)",
              status: (data.status ?? "active") as OverviewConvo["status"],
              channel: data.channel ?? "email",
              assignedAgent: data.assignedAgent ?? "",
              archived: !!data.archived,
              timestamp: data.timestamp,
              unread: !!data.unread,
            };
          })
          .filter((c) => !!c.assignedAgent && !c.archived);
        setOverviewConvos(rows);
      },
      (err) => {
        console.warn("Overview conversations listener error:", err);
        setOverviewConvos([]);
      }
    );
    return unsub;
  }, [isWebmaster]);

  // Group by assignedAgent, sorted by total open load (active+waiting) descending.
  const overviewByAgent = useMemo(() => {
    const map = new Map<string, OverviewConvo[]>();
    for (const c of overviewConvos) {
      const arr = map.get(c.assignedAgent) ?? [];
      arr.push(c);
      map.set(c.assignedAgent, arr);
    }
    return Array.from(map.entries())
      .map(([agent, convos]) => {
        const open = convos.filter((c) => c.status !== "resolved").length;
        const active = convos.filter((c) => c.status === "active").length;
        const waiting = convos.filter((c) => c.status === "waiting").length;
        const resolved = convos.filter((c) => c.status === "resolved").length;
        return { agent, convos, open, active, waiting, resolved };
      })
      .sort((a, b) => b.open - a.open || a.agent.localeCompare(b.agent));
  }, [overviewConvos]);

  // Track which agent rows are expanded in the Overview list.
  const [openOverview, setOpenOverview] = useState<Set<string>>(new Set());
  const toggleOverview = (agent: string) => {
    setOpenOverview((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  };

  // ---- Reassign workload (webmaster only) ----
  // Bulk move N of one agent's open conversations to another agent in one batch
  // write. Uses the same `assignedAgent` field that the Conversations page reads,
  // so updates appear live everywhere via the existing onSnapshot listeners.
  const [reassignFrom, setReassignFrom] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState<string>("");
  const [reassignCount, setReassignCount] = useState<number>(1);
  const [reassigning, setReassigning] = useState(false);

  const openReassignDialog = (agent: string) => {
    setReassignFrom(agent);
    setReassignTo("");
    const row = overviewByAgent.find((r) => r.agent === agent);
    const open = row?.open ?? 0;
    setReassignCount(Math.max(1, Math.min(open, Math.ceil(open / 2))));
  };

  const closeReassignDialog = () => {
    setReassignFrom(null);
    setReassignTo("");
    setReassignCount(1);
  };

  // Other agents available as reassignment targets (live from accounts list
  // PLUS any manually-added local agents, excluding the source agent and
  // any webmaster).
  const reassignTargets = useMemo(() => {
    if (!reassignFrom) return [] as string[];
    const fromAccounts = accounts
      .filter((a) => a.role === "agent" || a.role === "admin")
      .map((a) => (a.displayName || a.email || "").trim());
    const fromLocal = localAgents.map((a) => a.displayName.trim());
    const names = [...fromAccounts, ...fromLocal].filter(
      (n) => !!n && n !== reassignFrom
    );
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  }, [accounts, localAgents, reassignFrom]);

  const sourceRowForReassign = useMemo(
    () => (reassignFrom ? overviewByAgent.find((r) => r.agent === reassignFrom) ?? null : null),
    [reassignFrom, overviewByAgent]
  );

  // ---- Seed demo data (webmaster only) ----
  // Quickly creates 5 fake "active" conversations all assigned to a single agent
  // so the Overloaded badge, the assignment banner, and the Reassign workload
  // dialog have realistic data to exercise during end-to-end tests.
  const [seeding, setSeeding] = useState(false);
  const seedDemoData = async () => {
    // Always assign demo conversations to a REAL existing agent (or admin) so
    // the assignment banner test fires end-to-end. If no such account exists,
    // refuse and surface a clear error rather than silently inventing one.
    const targetAccount =
      accounts.find((a) => a.role === "agent") ??
      accounts.find((a) => a.role === "admin");
    if (!targetAccount) {
      toast({
        title: "No agent to assign to",
        description:
          "Create or sign in at least one agent account first (e.g. agent1@convohub.dev), then re-run Seed demo data.",
        variant: "destructive",
      });
      return;
    }
    const targetAgent = (targetAccount.displayName || targetAccount.email || "").trim();
    if (!targetAgent) {
      toast({
        title: "Agent has no display name",
        description: "Set a display name on the chosen agent before seeding.",
        variant: "destructive",
      });
      return;
    }

    setSeeding(true);
    try {
      const samples = [
        { customerName: "Ava Patel",       channel: "email", status: "active",  lastMessage: "My order hasn't arrived yet — can you check?" },
        { customerName: "Marcus Chen",     channel: "sms",   status: "active",  lastMessage: "Hey, the discount code isn't working at checkout." },
        { customerName: "Sofia Rodriguez", channel: "email", status: "waiting", lastMessage: "Following up on the refund request from last week." },
        { customerName: "Jamal Williams",  channel: "phone", status: "active",  lastMessage: "Left a voicemail about the billing question." },
        { customerName: "Priya Sharma",    channel: "slack", status: "active",  lastMessage: "Quick q — does your plan include API access?" },
      ];
      // Use a batch so all 5 conversations land atomically and the Overview
      // jumps straight from 0 → 5 (triggering the Overloaded threshold of 3).
      const batch = writeBatch(db);
      for (const s of samples) {
        const ref = doc(collection(db, "conversations"));
        batch.set(ref, {
          customerName: s.customerName,
          customerEmail: `${s.customerName.toLowerCase().replace(/\s+/g, ".")}@example.com`,
          customerPhone: null,
          lastMessage: s.lastMessage,
          channel: s.channel,
          status: s.status,
          assignedAgent: targetAgent,
          unread: true,
          archived: false,
          demo: true,
          timestamp: new Date(),
        });
      }
      await batch.commit();
      toast({
        title: "Demo data seeded",
        description: `Created 5 conversations assigned to ${targetAgent}.`,
      });
    } catch (e: any) {
      toast({
        title: "Could not seed demo data",
        description: e?.message || "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSeeding(false);
    }
  };

  const [clearingDemo, setClearingDemo] = useState(false);
  const clearDemoData = async () => {
    setClearingDemo(true);
    try {
      const snap = await getDocs(query(collection(db, "conversations"), where("demo", "==", true)));
      if (snap.empty) {
        toast({ title: "No demo conversations to clear" });
        return;
      }
      // Firestore batch limit is 500 ops; chunk to be safe.
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(db);
        for (const d of docs.slice(i, i + 400)) batch.delete(d.ref);
        await batch.commit();
      }
      toast({
        title: "Demo data cleared",
        description: `Deleted ${docs.length} demo conversation${docs.length === 1 ? "" : "s"}.`,
      });
    } catch (e: any) {
      toast({
        title: "Could not clear demo data",
        description: e?.message || "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setClearingDemo(false);
    }
  };

  const submitReassign = async () => {
    if (!reassignFrom || !reassignTo) return;
    if (!sourceRowForReassign) return;
    const eligible = sourceRowForReassign.convos
      .filter((c) => c.status !== "resolved")
      .slice(0, Math.max(1, Math.min(reassignCount, sourceRowForReassign.open)));
    if (eligible.length === 0) {
      toast({ title: "Nothing to reassign", variant: "destructive" });
      return;
    }
    setReassigning(true);
    try {
      const batch = writeBatch(db);
      for (const c of eligible) {
        batch.update(doc(db, "conversations", c.id), { assignedAgent: reassignTo });
      }
      await batch.commit();
      toast({
        title: "Workload reassigned",
        description: `Moved ${eligible.length} conversation${eligible.length === 1 ? "" : "s"} from ${reassignFrom} to ${reassignTo}.`,
      });
      closeReassignDialog();
    } catch (e: any) {
      toast({ title: "Reassign failed", description: e?.message, variant: "destructive" });
    } finally {
      setReassigning(false);
    }
  };

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

  // ---- Managed passwords (webmaster only) ---------------------------------
  // Mirror of /managedPasswords/{uid}. Webmaster-only (rules enforce). When
  // Firestore is unreachable we fall back to localStorage so the webmaster
  // can still see the last-set password offline.
  const [managedPasswords, setManagedPasswords] = useState<Record<string, string>>({});
  const [revealedUid, setRevealedUid] = useState<string | null>(null);
  const [pwDialogUid, setPwDialogUid] = useState<string | null>(null);
  const [pwDraft, setPwDraft] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    if (!isWebmaster) return;
    const unsub = onSnapshot(
      collection(db, "managedPasswords"),
      (snap) => {
        const next: Record<string, string> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as { password?: string };
          if (typeof data.password === "string") {
            next[d.id] = data.password;
            // Refresh local cache so offline lookups stay current.
            setLocalManagedPassword(d.id, data.password);
          }
        });
        setManagedPasswords(next);
      },
      (err) => {
        console.warn("managedPasswords listener error:", err);
        setManagedPasswords({});
      }
    );
    return unsub;
  }, [isWebmaster]);

  const getDisplayPassword = (uid: string): string | null => {
    return managedPasswords[uid] ?? getLocalManagedPassword(uid);
  };

  const openPasswordDialog = (uid: string) => {
    setPwDraft(getDisplayPassword(uid) ?? "");
    setPwDialogUid(uid);
  };

  const saveManagedPassword = async (uid: string, email: string) => {
    const trimmed = pwDraft;
    if (trimmed.length < 6) {
      toast({ title: "Password too short", description: "Minimum 6 characters.", variant: "destructive" });
      return;
    }
    setPwSaving(true);
    try {
      const fn = httpsCallable<{ targetUid: string; newPassword: string }, { ok: boolean }>(
        functions,
        "setUserPassword"
      );
      await fn({ targetUid: uid, newPassword: trimmed });
      // Optimistic local mirror in case the listener is slow.
      setManagedPasswords((prev) => ({ ...prev, [uid]: trimmed }));
      setLocalManagedPassword(uid, trimmed);
      toast({ title: "Password updated", description: `${email || uid} can now sign in with the new password.` });
      setPwDialogUid(null);
      setPwDraft("");
    } catch (e: any) {
      // Even if the cloud call fails, persist locally so the webmaster
      // doesn't lose what they just typed.
      setLocalManagedPassword(uid, trimmed);
      toast({ title: "Password save failed", description: e?.message ?? "Saved locally as fallback.", variant: "destructive" });
    } finally {
      setPwSaving(false);
    }
  };

  const copyPassword = async (uid: string) => {
    const pw = getDisplayPassword(uid);
    if (!pw) {
      toast({ title: "No password on file", description: "Set one first.", variant: "destructive" });
      return;
    }
    try {
      await navigator.clipboard.writeText(pw);
      toast({ title: "Password copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };
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
          { id: "overview", label: "Overview" },
          { id: "webmaster-contact", label: "Webmaster contact" },
          { id: "bg-gmail", label: "Background Gmail ingestion" },
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
        <div id="profile" className="rounded-xl border border-border bg-card p-6">
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

        {/* Appearance — three-way toggle: light / dark / coder. "Coder Mode"
            is a soft-blue, low-contrast palette tuned for sensitive eyes. */}
        <div id="appearance" className="rounded-xl border border-border bg-card p-6">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-4">
            {theme === "light" ? (
              <Sun className="h-5 w-5 text-primary" />
            ) : theme === "dark" ? (
              <Moon className="h-5 w-5 text-primary" />
            ) : (
              <Eye className="h-5 w-5 text-primary" />
            )}
            Appearance
          </h3>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Theme</p>
              <p className="text-xs text-muted-foreground">
                Light, dark, or Coder Mode (soft-blue, low-contrast for sensitive eyes).
              </p>
            </div>
            <div className="inline-flex rounded-lg border border-border bg-background p-1">
              {(["light", "dark", "coder"] as const).map((t) => {
                const Icon = t === "light" ? Sun : t === "dark" ? Moon : Eye;
                const active = theme === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTheme(t)}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t === "coder" ? "Coder" : t}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Webmaster-only: contact cooldown duration */}
        {isWebmaster && (
          <div id="webmaster-contact" className="rounded-xl border border-border bg-card p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-2">
              <PhoneCall className="h-5 w-5 text-primary" />
              Webmaster contact cooldown
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              How long an agent must wait between consecutive Call/Text Webmaster
              shortcuts before the buttons swap to the
              <span className="font-medium text-foreground"> "Just contacted — call again?" </span>
              confirm dialog. Tune this lower during high-volume incidents so
              follow-ups aren't blocked.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Cooldown window</p>
                <p className="text-xs text-muted-foreground">
                  Applies to every agent and admin in real time.
                </p>
              </div>
              <Select
                value={String(cooldownMin)}
                onValueChange={handleCooldownChange}
                disabled={savingCooldown}
              >
                <SelectTrigger className="w-full sm:w-44" aria-label="Webmaster contact cooldown">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COOLDOWN_OPTIONS_MIN.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m} minutes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Recent contact events — last 10. Lets the on-call webmaster
                spot patterns at a glance ("agent X has texted me 4 times
                this hour, something's wrong") without leaving /settings.
                Append-only log; webmaster-only by Firestore rules. */}
            <div className="mt-6 border-t border-border pt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5 text-muted-foreground" />
                  Recent webmaster contacts
                </p>
                <span className="text-[11px] text-muted-foreground">
                  Last {Math.min(10, recentContacts.length) || 0} of 10
                </span>
              </div>
              {recentContacts.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3">
                  No contacts logged yet — events appear here as agents tap Call/Text.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border bg-muted/30">
                  {recentContacts.map((ev) => {
                    const when = ev.createdAt?.toDate ? ev.createdAt.toDate() : null;
                    const channelLabel = ev.channel === "call" ? "Called" : "Texted";
                    return (
                      <li
                        key={ev.id}
                        className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs"
                      >
                        <Badge
                          variant={ev.channel === "call" ? "default" : "secondary"}
                          className="gap-1 shrink-0"
                        >
                          {ev.channel === "call" ? (
                            <PhoneCall className="h-3 w-3" />
                          ) : (
                            <MessageCircle className="h-3 w-3" />
                          )}
                          {channelLabel}
                        </Badge>
                        <span className="font-medium text-foreground truncate min-w-0">
                          {ev.agentName}
                        </span>
                        <span className="text-muted-foreground truncate min-w-0">
                          from <code className="text-[10px] bg-background px-1 py-0.5 rounded">{ev.route}</code>
                        </span>
                        <span className="ml-auto text-muted-foreground shrink-0">
                          {when ? when.toLocaleString() : "—"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Webmaster-only: Background Gmail ingestion opt-in. Per-uid
            localStorage pref consumed by useBackgroundGmailPoller, which is
            mounted globally in AppLayout. */}
        {isWebmaster && (
          <div id="bg-gmail" className="rounded-xl border border-border bg-card p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-2">
              <Mail className="h-5 w-5 text-primary" />
              Background Gmail ingestion
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              When enabled, ConvoHub silently polls your Gmail INBOX every ~2 minutes and pushes new messages into the Conversations queue. Pausing here stops polling without revoking your Google OAuth consent — flip it back on any time to resume.
            </p>
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3">
              <div className="space-y-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Auto-ingest INBOX into Conversations
                </p>
                <p className="text-xs text-muted-foreground">
                  Requires a one-time Google authorization on{" "}
                  <Link to="/gmail" className="underline underline-offset-2 hover:text-foreground">
                    Gmail API
                  </Link>
                  . Server-side dedup prevents duplicates.
                </p>
              </div>
              <Switch
                checked={bgGmailEnabled}
                onCheckedChange={handleToggleBgGmail}
                aria-label="Background Gmail ingestion"
              />
            </div>
            {bgGmailEnabled && (
              <p className="mt-3 text-[11px] text-success flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                Polling active — next sweep within 2 minutes.
              </p>
            )}
          </div>
        )}

        {/* Webmaster-only: Slack DM webhook for the Call/Text shortcut.
            Stored team-wide in `appSettings/webmasterContact.slackWebhookUrl`
            so every agent's browser can read it (per-user integrations creds
            are owner-only). */}
        {canEditWebhook && (
          <div id="webmaster-slack" className="rounded-xl border border-border bg-card p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-2">
              <Send className="h-5 w-5 text-primary" />
              Webmaster Slack alerts
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Optional. When set, every Call/Text Webmaster shortcut tap pings this
              channel with the agent's name and current page — so the on-call
              webmaster sees the heads-up even when the app is closed. Use a Slack{" "}
              <a
                href="https://api.slack.com/messaging/webhooks"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                Incoming Webhook URL
              </a>{" "}
              for your alerts channel.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <Label htmlFor="webmaster-slack-webhook" className="text-xs">
                  Slack Incoming Webhook URL
                </Label>
                <Input
                  id="webmaster-slack-webhook"
                  type="url"
                  inputMode="url"
                  placeholder="https://hooks.slack.com/services/T.../B.../xxxx"
                  value={slackWebhookDraft}
                  onChange={(e) => setSlackWebhookDraft(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="flex flex-wrap gap-2 sm:shrink-0">
                <Button
                  onClick={handleSaveSlackWebhook}
                  disabled={savingSlackWebhook || !slackWebhookDraft.trim() || !canEditWebhook}
                  className="gap-1.5"
                >
                  <Check className="h-4 w-4" />
                  {savingSlackWebhook ? "Saving…" : "Save"}
                </Button>
                {slackConfigured && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      setSavingSlackWebhook(true);
                      try {
                        await setSlackWebhookUrl("");
                        toast({ title: "Slack webhook cleared" });
                      } catch (e: any) {
                        toast({ title: "Could not clear", description: e?.message, variant: "destructive" });
                      } finally {
                        setSavingSlackWebhook(false);
                      }
                    }}
                    disabled={savingSlackWebhook || !canEditWebhook}
                    aria-label="Clear webhook"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {slackConfigured
                ? "Active — server-side proxy will forward Ping Slack alerts. URL is hidden from the browser."
                : "Not configured — only in-app bell notifications fire."}
            </p>
          </div>
        )}

        {/* Webmaster-only: Overview — at-a-glance assigned conversations per agent */}
        {isWebmaster && (
          <div id="overview" className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground">
                <LayoutDashboard className="h-5 w-5 text-primary" />
                Overview
                {overviewByAgent.length > 0 && (
                  <Badge variant="secondary" className="ml-1">{overviewByAgent.length}</Badge>
                )}
              </h3>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={seedDemoData}
                  disabled={seeding}
                  aria-label="Seed 5 demo conversations assigned to one agent"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  {seeding ? "Seeding..." : "Seed demo data"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={clearDemoData}
                  disabled={clearingDemo}
                  aria-label="Delete every conversation marked as demo"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {clearingDemo ? "Clearing..." : "Clear demo data"}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Live snapshot of every agent and admin with assigned conversations. Click a row
              to expand the list of threads, or open one directly. The same auto-push logic
              sends each agent to one of these conversations the next time they sign in.
            </p>
            {overviewByAgent.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No conversations are currently assigned to anyone.
              </div>
            ) : (
              <div className="space-y-2">
                {overviewByAgent.map((row) => {
                  const isOpen = openOverview.has(row.agent);
                  const overloaded = row.open >= 3;
                  return (
                    <div
                      key={row.agent}
                      className="rounded-lg border border-border bg-background"
                    >
                      <div className="w-full flex items-center gap-3 p-3 rounded-lg">
                        <button
                          type="button"
                          onClick={() => toggleOverview(row.agent)}
                          className="flex flex-1 min-w-0 items-center gap-3 text-left hover:bg-muted/40 transition-colors rounded-md -m-1 p-1"
                          aria-expanded={isOpen}
                        >
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                            {row.agent.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-foreground truncate">
                                {row.agent}
                              </span>
                              {overloaded && (
                                <Badge variant="outline" className="text-[10px] gap-1 border-destructive/40 text-destructive">
                                  <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                                  Overloaded
                                </Badge>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                                {row.active} active
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                                {row.waiting} waiting
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                                {row.resolved} resolved
                              </span>
                            </div>
                          </div>
                        </button>
                        <div className="flex flex-shrink-0 items-center gap-2">
                          {overloaded && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 px-2 text-[11px] border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                openReassignDialog(row.agent);
                              }}
                              aria-label={`Reassign workload from ${row.agent}`}
                            >
                              <ArrowRightLeft className="h-3 w-3" /> Reassign
                            </Button>
                          )}
                          <Badge
                            variant={overloaded ? "destructive" : "secondary"}
                          >
                            {row.open} open
                          </Badge>
                        </div>
                      </div>
                      {isOpen && (
                        <ul className="space-y-1 border-t border-border p-3">
                          {row.convos.slice(0, 10).map((c) => (
                            <li key={c.id}>
                              <Link
                                to={`/conversations/${c.id}`}
                                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent transition-colors"
                              >
                                <MessageCircle className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                <span className="font-medium text-foreground truncate">{c.customerName}</span>
                                <Badge
                                  variant="outline"
                                  className="ml-auto text-[10px] capitalize flex-shrink-0"
                                >
                                  {c.status}
                                </Badge>
                                <Badge variant="outline" className="text-[10px] uppercase flex-shrink-0">
                                  {c.channel}
                                </Badge>
                                {c.unread && (
                                  <span className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                                )}
                              </Link>
                            </li>
                          ))}
                          {row.convos.length > 10 && (
                            <li className="px-2 py-1 text-[10px] text-muted-foreground italic">
                              + {row.convos.length - 10} more
                            </li>
                          )}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Bulk reassignment dialog (webmaster only). Opened from an overloaded
            Overview row; moves N most-recent open conversations from one agent
            to another in a single Firestore batch write. */}
        <Dialog
          open={!!reassignFrom}
          onOpenChange={(open) => {
            if (!open) closeReassignDialog();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4 text-primary" />
                Reassign workload
              </DialogTitle>
              <DialogDescription>
                Move open conversations from <span className="font-medium text-foreground">{reassignFrom}</span>{" "}
                to another agent in one click.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reassign-to">Reassign to</Label>
                <Select value={reassignTo} onValueChange={setReassignTo}>
                  <SelectTrigger id="reassign-to">
                    <SelectValue placeholder="Choose an agent…" />
                  </SelectTrigger>
                  <SelectContent>
                    {reassignTargets.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-muted-foreground">
                        No other agents available.
                      </div>
                    ) : (
                      reassignTargets.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reassign-count">
                  Number of conversations to move
                  {sourceRowForReassign && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (1–{sourceRowForReassign.open})
                    </span>
                  )}
                </Label>
                <Input
                  id="reassign-count"
                  type="number"
                  min={1}
                  max={sourceRowForReassign?.open ?? 1}
                  value={reassignCount}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isFinite(n)) return;
                    const max = sourceRowForReassign?.open ?? 1;
                    setReassignCount(Math.max(1, Math.min(max, n)));
                  }}
                />
                <p className="text-[11px] text-muted-foreground">
                  Most-recent open conversations are moved first. Resolved threads are skipped.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeReassignDialog} disabled={reassigning}>
                Cancel
              </Button>
              <Button
                onClick={submitReassign}
                disabled={reassigning || !reassignTo || (sourceRowForReassign?.open ?? 0) === 0}
                className="gap-2"
              >
                <ArrowRightLeft className="h-4 w-4" />
                {reassigning ? "Reassigning…" : `Move ${Math.min(reassignCount, sourceRowForReassign?.open ?? 0)}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Webmaster-only: Promote */}
        {isWebmaster && (
          <div id="promote" className="rounded-xl border border-primary/30 bg-primary/5 p-6">
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
          <div id="pending" className="rounded-xl border border-border bg-card p-6">
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
          <div id="agents" className="rounded-xl border border-border bg-card p-6">
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
          <div id="accounts" className="rounded-xl border border-border bg-card p-6">
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
                      {/* Password row (webmaster vault). Shows masked dots
                          unless the eye is toggled; falls back to
                          localStorage when Firestore is unavailable. */}
                      {(() => {
                        const stored = getDisplayPassword(acc.uid);
                        const revealed = revealedUid === acc.uid;
                        return (
                          <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                            <KeyRound className="h-3 w-3 text-muted-foreground" />
                            <span className="text-muted-foreground">Password:</span>
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                              {stored ? (revealed ? stored : "•".repeat(Math.min(stored.length, 12))) : "(not set via vault)"}
                            </code>
                            {stored && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setRevealedUid(revealed ? null : acc.uid)}
                                  className="text-muted-foreground hover:text-foreground"
                                  aria-label={revealed ? "Hide password" : "Show password"}
                                >
                                  {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => copyPassword(acc.uid)}
                                  className="text-muted-foreground hover:text-foreground"
                                  aria-label="Copy password"
                                >
                                  <Copy className="h-3 w-3" />
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => openPasswordDialog(acc.uid)}
                              className="ml-1 text-primary hover:underline"
                            >
                              {stored ? "Change" : "Set"}
                            </button>
                          </div>
                        );
                      })()}
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

        {/* Webmaster-only: Set/change password dialog */}
        {isWebmaster && (
          <Dialog
            open={!!pwDialogUid}
            onOpenChange={(o) => {
              if (!o) {
                setPwDialogUid(null);
                setPwDraft("");
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-primary" />
                  {(() => {
                    const acc = accounts.find((a) => a.uid === pwDialogUid);
                    return `Set password for ${acc?.displayName || acc?.email || "user"}`;
                  })()}
                </DialogTitle>
                <DialogDescription>
                  Updates Firebase Auth immediately. The value is mirrored to{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[11px]">managedPasswords/{pwDialogUid ?? "{uid}"}</code>{" "}
                  and your local browser cache so you can look it up later.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <Label htmlFor="managed-password">New password</Label>
                <Input
                  id="managed-password"
                  type="text"
                  value={pwDraft}
                  onChange={(e) => setPwDraft(e.target.value)}
                  placeholder="At least 6 characters"
                  className="font-mono"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  The user can sign in with this password right away. Existing sessions remain valid until they sign out.
                </p>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => { setPwDialogUid(null); setPwDraft(""); }} disabled={pwSaving}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    const acc = accounts.find((a) => a.uid === pwDialogUid);
                    if (acc) saveManagedPassword(acc.uid, acc.email);
                  }}
                  disabled={pwSaving || pwDraft.length < 6}
                  className="gap-1.5"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  {pwSaving ? "Saving…" : "Save password"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
          <div id="investigations" className="rounded-xl border border-border bg-card p-6">
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
          <div id="escalate" className="rounded-xl border border-accent/40 bg-accent/5 p-6">
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
        <div id="security" className="rounded-xl border border-border bg-card p-6">
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
