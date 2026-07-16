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
  RotateCcw,
  Archive as ArchiveIcon,
  AlertCircle,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import RoleBadge from "@/components/RoleBadge";
import { getBoolPref, setBoolPrefRemote, subscribeBoolPrefRemote } from "@/lib/userPrefs";
import { BG_GMAIL_INGEST_PREF } from "@/hooks/useBackgroundGmailPoller";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { AccountActionsMenu } from "@/components/AccountActionsMenu";
import PrivacyDataCard from "@/components/PrivacyDataCard";

import AgentRosterPanel from "@/components/AgentRosterPanel";
import SignupApprovalsPanel from "@/components/SignupApprovalsPanel";
import AuthorizedDomainsPanel from "@/components/AuthorizedDomainsPanel";
import CustomerPortalTogglePanel from "@/components/CustomerPortalTogglePanel";
import DataSeedPanel from "@/components/DataSeedPanel";
import CallRecordingSettings from "@/components/CallRecordingSettings";
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
import "@/lib/managedPasswords"; // side-effect: purges legacy localStorage keys
import {
  encryptWithPassphrase,
  decryptWithPassphrase,
  buildSentinel,
  verifySentinel,
  cachePassphrase,
  getCachedPassphrase,
  clearVault,
  type EncryptedBlob,
} from "@/lib/passwordVault";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  doc,
  setDoc,
  serverTimestamp,
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
import { pingWebmasterSlackAlert } from "@/lib/notifyWebmaster";

// (Email-based escalation routing was removed — escalations now flow into
// the in-app notifications queue via requestWebmasterEscalation.)

interface PendingEscalation {
  id: string;
  requesterUid: string;
  requesterEmail: string | null;
  requesterName: string | null;
  requesterRole: string;
  reason: string;
  status: "pending" | "approved" | "denied" | string;
  requestType: string;
  source: string | null;
  targetIdentifier: string | null;
  deliveryChannel: string | null;
  emailSent: boolean;
  createdAt: any;
  archived?: boolean;
}

interface AccountRow {
  uid: string;
  email: string;
  displayName: string;
  role: "agent" | "admin" | "webmaster";
  escalatedAccess?: boolean;
  supportAccess?: boolean;
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
  const NAV_WIDTH_KEY = "ConvoHub.settings.navWidth";
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

  // Promote-to-Webmaster has been removed from Settings entirely. Role
  // changes are now handled through the Accounts panel + server-side
  // callables (`promoteToWebmaster` / `demoteAgent`) and are no longer
  // self-service from this surface.


  // Provision Support account flow removed — Support is no longer a managed
  // role in this product. Webmasters grant access via the Accounts panel.


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
    // Single-field where → no composite index required. We sort + slice to
    // newest client-side. The user only ever has a handful of escalation
    // requests, so the cost of fetching them all is trivial.
    const q = query(
      collection(db, "escalationRequests"),
      where("requesterUid", "==", user.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setLatestRequest(null);
          return;
        }
        const sorted = snap.docs
          .map((d) => d.data() as any)
          .sort((a, b) => {
            const am = a.createdAt?.toMillis?.() ?? 0;
            const bm = b.createdAt?.toMillis?.() ?? 0;
            return bm - am;
          });
        const d = sorted[0];
        setLatestRequest({
          status: d.status || "pending",
          emailSent: !!d.emailSent,
          createdAt: d.createdAt,
        });
      },
      (err) => {
        console.warn("Latest escalation request listener error:", err);
        setLatestRequest(null);
      }
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
    // Single-field where → no composite index required. Filter+sort client-side.
    const q = query(
      collection(db, "roleGrants"),
      where("targetUid", "==", user.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const revokes = snap.docs
          .map((d) => d.data() as any)
          .filter((d) => d.action === "revokeEscalatedAccess")
          .sort((a, b) => {
            const am = a.grantedAt?.toMillis?.() ?? 0;
            const bm = b.grantedAt?.toMillis?.() ?? 0;
            return bm - am;
          });
        if (revokes.length === 0) {
          setLatestRevoke(null);
          return;
        }
        const d = revokes[0];
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
      const fn = httpsCallable<
        { reason: string },
        { ok: boolean; notified?: number; notifyError?: string | null; emailSent?: boolean }
      >(functions, "requestWebmasterEscalation");
      const res = await fn({ reason });
      const notified = res.data.notified ?? 0;
      if (notified > 0) {
        toast({
          title: "Escalation sent to webmaster",
          description: `Posted to ${notified} webmaster bell${notified === 1 ? "" : "s"}. They'll review shortly.`,
        });
      } else {
        toast({
          title: "Request recorded",
          description:
            res.data.notifyError ||
            "No webmasters were online to notify, but your request is logged for review.",
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
  const [testingSlackWebhook, setTestingSlackWebhook] = useState(false);
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

  const handleTestSlackWebhook = async () => {
    setTestingSlackWebhook(true);
    try {
      const res = await pingWebmasterSlackAlert({ route: "/settings" });
      toast({
        title: res.ok ? "Slack channel pinged" : res.rateLimited ? "Cooldown active" : "Slack test failed",
        description: res.ok
          ? "Webhook test ping accepted — the channel was notified."
          : res.error || "The webhook test was not accepted. Check the saved URL and deployed functions.",
        variant: res.ok ? undefined : "destructive",
      });
    } finally {
      setTestingSlackWebhook(false);
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

  // ---- Escalation requests (webmaster only) ----
  const [pending, setPending] = useState<PendingEscalation[]>([]);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isWebmaster) return;
    // Read all escalation rows so approved promotion audit entries remain
    // visible here instead of disappearing from the pending-only queue.
    const q = query(
      collection(db, "escalationRequests")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: PendingEscalation[] = snap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              requesterUid: data.requesterUid,
              requesterEmail: data.requesterEmail ?? null,
              requesterName: data.requesterName ?? null,
              requesterRole: data.requesterRole ?? "admin",
              reason: data.reason ?? "",
              status: data.status ?? "pending",
              requestType: data.requestType ?? "access",
              source: data.source ?? null,
              targetIdentifier: data.targetIdentifier ?? null,
              deliveryChannel: data.deliveryChannel ?? null,
              emailSent: !!data.emailSent,
              createdAt: data.createdAt,
              archived: !!data.archived,
            };
          })
          // Hide archived rows from the active queue — they live on the Archive page.
          .filter((r) => !r.archived)
          .sort((a, b) => {
            const am = a.createdAt?.toMillis?.() ?? 0;
            const bm = b.createdAt?.toMillis?.() ?? 0;
            return bm - am;
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
  const pendingCount = pending.filter((req) => req.status === "pending").length;

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

  /** Resolve / reopen / archive an escalation row. The Archive page surfaces
   *  archived rows alongside archived conversations. */
  const [managingId, setManagingId] = useState<string | null>(null);
  const manageEscalation = async (
    requestId: string,
    action: "resolve" | "reopen" | "archive"
  ) => {
    setManagingId(requestId);
    try {
      const fn = httpsCallable<
        { requestId: string; action: typeof action },
        { ok: boolean; action: string }
      >(functions, "manageEscalationRequest");
      await fn({ requestId, action });
      toast({
        title:
          action === "resolve"
            ? "Marked resolved"
            : action === "reopen"
            ? "Reopened"
            : "Moved to Archive",
        description:
          action === "archive"
            ? "Visible on the Archive page for 30 days, then permanently removed."
            : undefined,
      });
    } catch (e: any) {
      toast({ title: "Could not update", description: e?.message, variant: "destructive" });
    } finally {
      setManagingId(null);
    }
  };

  // ---- All accounts (webmaster only) ----
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  /** Controlled state for the per-account delete confirmation dialog —
   *  lifted out of the row so the AccountActionsMenu can open it from
   *  either the inline desktop button or the mobile ⋯ menu. */
  const [deleteDialogUid, setDeleteDialogUid] = useState<string | null>(null);

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
            supportAccess: !!data.supportAccess,
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
  // signed up yet (e.g. agent1@ConvoHub.dev seeded by default).
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
          "Create or sign in at least one agent account first (e.g. agent1@ConvoHub.dev), then re-run Seed demo data.",
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

  // ---- Managed passwords vault (webmaster only) -------------------------
  // Plaintext is NEVER stored. Each managedPasswords/{uid} doc holds an
  // AES-GCM ciphertext that the webmaster decrypts in-browser using their
  // vault passphrase. The passphrase lives in module memory only — never
  // persisted to localStorage. See src/lib/passwordVault.ts.
  const [vaultEntries, setVaultEntries] = useState<Record<string, EncryptedBlob>>({});
  const [vaultPlain, setVaultPlain] = useState<Record<string, string>>({});
  const [revealedUid, setRevealedUid] = useState<string | null>(null);
  const [pwDialogUid, setPwDialogUid] = useState<string | null>(null);
  const [pwDraft, setPwDraft] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  // Vault unlock state
  const [vaultSentinel, setVaultSentinel] = useState<EncryptedBlob | null>(null);
  const [vaultUnlocked, setVaultUnlocked] = useState<boolean>(!!getCachedPassphrase());
  const [vaultDialogOpen, setVaultDialogOpen] = useState(false);
  const [vaultPassphrase, setVaultPassphrase] = useState("");
  const [vaultPassphraseConfirm, setVaultPassphraseConfirm] = useState("");
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [vaultStep, setVaultStep] = useState<"idle" | "deriving" | "writing" | "done">("idle");

  useEffect(() => {
    if (!isWebmaster) return;
    const unsub = onSnapshot(
      collection(db, "managedPasswords"),
      (snap) => {
        const next: Record<string, EncryptedBlob> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          if (typeof data.ciphertext === "string" && typeof data.iv === "string" && typeof data.salt === "string") {
            next[d.id] = {
              ciphertext: data.ciphertext,
              iv: data.iv,
              salt: data.salt,
              algo: data.algo || "AES-GCM-256/PBKDF2-SHA256",
              iterations: typeof data.iterations === "number" ? data.iterations : 200_000,
            };
          }
        });
        setVaultEntries(next);
      },
      (err) => {
        console.warn("managedPasswords listener error:", err);
        setVaultEntries({});
      }
    );
    return unsub;
  }, [isWebmaster]);

  // Subscribe to the vault sentinel doc (used to verify the passphrase).
  useEffect(() => {
    if (!isWebmaster) return;
    const unsub = onSnapshot(
      doc(db, "appSettings", "vaultCheck"),
      (snap) => {
        const data = snap.data() as any;
        if (data && typeof data.ciphertext === "string") {
          setVaultSentinel({
            ciphertext: data.ciphertext,
            iv: data.iv,
            salt: data.salt,
            algo: data.algo || "AES-GCM-256/PBKDF2-SHA256",
            iterations: typeof data.iterations === "number" ? data.iterations : 200_000,
          });
        } else {
          setVaultSentinel(null);
        }
      },
      (err) => console.warn("vaultCheck listener error:", err)
    );
    return unsub;
  }, [isWebmaster]);

  const isVaultInitialized = vaultSentinel !== null;

  const openVaultDialog = () => {
    setVaultPassphrase("");
    setVaultPassphraseConfirm("");
    setVaultDialogOpen(true);
  };

  const passphraseStrength = (pass: string): { score: number; label: string } => {
    let score = 0;
    if (pass.length >= 8) score += 25;
    if (pass.length >= 14) score += 25;
    if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score += 15;
    if (/\d/.test(pass)) score += 15;
    if (/[^A-Za-z0-9]/.test(pass)) score += 20;
    score = Math.min(100, score);
    const label = score < 40 ? "Weak" : score < 70 ? "Fair" : score < 90 ? "Strong" : "Excellent";
    return { score, label };
  };

  const handleVaultUnlock = async () => {
    setVaultError(null);
    const pass = vaultPassphrase;
    if (pass.length < 8) {
      setVaultError("Passphrase must be at least 8 characters.");
      return;
    }
    setVaultBusy(true);
    setVaultStep("deriving");
    try {
      if (!isVaultInitialized) {
        if (pass !== vaultPassphraseConfirm) {
          setVaultError("Passphrases do not match. Re-enter both fields exactly.");
          setVaultStep("idle");
          return;
        }
        if (passphraseStrength(pass).score < 40) {
          setVaultError("Passphrase is too weak. Add length, mixed case, numbers or symbols.");
          setVaultStep("idle");
          return;
        }
        const sentinel = await buildSentinel(pass);
        setVaultStep("writing");
        await setDoc(doc(db, "appSettings", "vaultCheck"), {
          ...sentinel,
          createdByUid: user?.uid ?? null,
          createdByEmail: profile?.email ?? null,
          createdAt: serverTimestamp(),
        });
        cachePassphrase(pass);
        setVaultUnlocked(true);
        setVaultStep("done");
        setTimeout(() => {
          setVaultDialogOpen(false);
          setVaultStep("idle");
        }, 600);
        toast({ title: "Vault initialized", description: "Remember this passphrase — it cannot be recovered." });
      } else {
        const ok = await verifySentinel(vaultSentinel!, pass);
        if (!ok) {
          setVaultError("Wrong passphrase. The vault could not be decrypted.");
          setVaultStep("idle");
          return;
        }
        cachePassphrase(pass);
        setVaultUnlocked(true);
        setVaultStep("done");
        setTimeout(() => {
          setVaultDialogOpen(false);
          setVaultStep("idle");
        }, 400);
        toast({ title: "Vault unlocked" });
      }
    } catch (e: any) {
      setVaultError(e?.message || "Vault operation failed.");
      setVaultStep("idle");
    } finally {
      setVaultBusy(false);
    }
  };

  const handleVaultLock = () => {
    clearVault();
    setVaultUnlocked(false);
    setVaultPlain({});
    setRevealedUid(null);
    toast({ title: "Vault locked" });
  };

  const decryptEntry = async (uid: string): Promise<string | null> => {
    const blob = vaultEntries[uid];
    if (!blob) return null;
    const pass = getCachedPassphrase();
    if (!pass) {
      openVaultDialog();
      return null;
    }
    if (vaultPlain[uid]) return vaultPlain[uid];
    try {
      const pt = await decryptWithPassphrase(blob, pass);
      setVaultPlain((prev) => ({ ...prev, [uid]: pt }));
      return pt;
    } catch {
      toast({ title: "Decryption failed", description: "Stored ciphertext could not be decrypted with the current passphrase.", variant: "destructive" });
      return null;
    }
  };

  const openPasswordDialog = (uid: string) => {
    if (!vaultUnlocked) {
      openVaultDialog();
      return;
    }
    setPwDraft("");
    setPwDialogUid(uid);
  };

  const saveManagedPassword = async (uid: string, email: string) => {
    const trimmed = pwDraft;
    if (trimmed.length < 6) {
      toast({ title: "Password too short", description: "Minimum 6 characters.", variant: "destructive" });
      return;
    }
    const pass = getCachedPassphrase();
    if (!pass) {
      toast({ title: "Vault locked", description: "Unlock the vault first.", variant: "destructive" });
      openVaultDialog();
      return;
    }
    setPwSaving(true);
    try {
      const fn = httpsCallable<{ targetUid: string; newPassword: string }, { ok: boolean }>(
        functions,
        "setUserPassword"
      );
      await fn({ targetUid: uid, newPassword: trimmed });
      const blob = await encryptWithPassphrase(trimmed, pass);
      await setDoc(
        doc(db, "managedPasswords", uid),
        { ...blob, email, updatedAt: serverTimestamp() },
        { merge: true }
      );
      setVaultPlain((prev) => ({ ...prev, [uid]: trimmed }));
      toast({ title: "Password updated", description: `${email || uid} can now sign in with the new password.` });
      setPwDialogUid(null);
      setPwDraft("");
    } catch (e: any) {
      toast({ title: "Password save failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setPwSaving(false);
    }
  };

  const copyPassword = async (uid: string) => {
    const pw = await decryptEntry(uid);
    if (!pw) return;
    try {
      await navigator.clipboard.writeText(pw);
      toast({ title: "Password copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const revealPassword = async (uid: string) => {
    if (revealedUid === uid) {
      setRevealedUid(null);
      return;
    }
    const pw = await decryptEntry(uid);
    if (pw) setRevealedUid(uid);
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

  // ---- Grant / revoke Support access (webmaster only) ----
  // Flips `users/{uid}.supportAccess` via the `setSupportAccess` callable.
  // Granted users land on the Support call-center home at `/` next time they
  // load the app and gain chat-moderator powers.
  const [supportChangingUid, setSupportChangingUid] = useState<string | null>(null);
  const setSupportAccessFor = async (acc: AccountRow, grant: boolean) => {
    setSupportChangingUid(acc.uid);
    try {
      const fn = httpsCallable<{ targetUid: string; grant: boolean }, { ok: boolean; supportAccess: boolean }>(
        functions,
        "setSupportAccess"
      );
      await fn({ targetUid: acc.uid, grant });
      toast({
        title: grant ? "Support access granted" : "Support access revoked",
        description: `${acc.email || acc.uid} ${grant ? "now sees the Support home and can moderate chat." : "no longer has Support access."}`,
      });
    } catch (e: any) {
      toast({
        title: grant ? "Grant failed" : "Revoke failed",
        description: e?.message || "Unable to update Support access.",
        variant: "destructive",
      });
    } finally {
      setSupportChangingUid(null);
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
    // Single-field where → no composite index required. Sort + cap client-side.
    const q = query(
      collection(db, "roleGrants"),
      where("action", "==", "renameAgent")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: RenameEvent[] = snap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              targetUid: data.targetUid ?? "",
              previousDisplayName: data.previousDisplayName ?? "",
              newDisplayName: data.newDisplayName ?? "",
              grantedByEmail: data.grantedByEmail ?? null,
              grantedAt: data.grantedAt,
            };
          })
          .sort((a, b) => {
            const am = a.grantedAt?.toMillis?.() ?? 0;
            const bm = b.grantedAt?.toMillis?.() ?? 0;
            return bm - am;
          })
          .slice(0, 100);
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
          { id: "pending", label: "Pending escalations" },
          { id: "agents", label: "Agents" },
          { id: "accounts", label: "Accounts" },
          { id: "investigations", label: "Investigation requests" },
        ]
      : [{ id: "escalate", label: "Escalate to Webmaster" }]),
  ];

  const showSideNav = isWebmaster && !isMobile;

  return (
    <div className={cn(
      "mx-auto",
      showSideNav ? "flex h-full max-w-6xl gap-0 p-0" : `px-3 py-4 sm:p-6 md:p-8 ${isWebmaster ? "max-w-4xl" : "max-w-2xl"}`
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
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <RoleBadge />
        </div>
        <p className="text-muted-foreground mt-1 text-sm md:text-base">Manage your account and preferences</p>
      </div>
      {/* Privacy & Data is hidden for plain agents — they don't need
          GDPR/CCPA export/delete controls on the work-only account. */}
      {profile?.role !== "agent" && <PrivacyDataCard />}

      {/* Mobile-only quick jump nav for webmasters — the desktop sidebar is
          hidden on phones, so without this they'd have to scroll the entire
          long settings page to reach Pending escalations / Agents / etc. */}
      {isWebmaster && isMobile && (
        <div className="mb-4 sm:mb-6">
          <Label className="text-xs text-muted-foreground">Jump to section</Label>
          <Select
            onValueChange={(id) => {
              document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            <SelectTrigger className="mt-1 h-9 text-sm">
              <SelectValue placeholder="Select a section…" />
            </SelectTrigger>
            <SelectContent>
              {navSections.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-6 md:space-y-8">
        {/* Profile */}
        <div id="profile" className="rounded-xl border border-border bg-card p-4 sm:p-6">
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
        <div id="appearance" className="rounded-xl border border-border bg-card p-4 sm:p-6">
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

        {/* Environment variables panel removed — no longer surfaced to operators. */}


        {/* Call recording & retention policy — admin/webmaster editable;
            agents see read-only. Drives the consent banner and auto-purge
            behavior surfaced on /call-analytics. */}
        <CallRecordingSettings />

        {/* Webmaster-only: contact cooldown duration */}
        {isWebmaster && (
          <div id="webmaster-contact" className="rounded-xl border border-border bg-card p-4 sm:p-6">
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

            {/* Internal agent logs — append-only record of every webmaster
                ping (call, text, or in-app Slack/internal alert) so the
                on-call webmaster can spot patterns ("agent X pinged 4 times
                this hour, something's wrong") without leaving /settings.
                Webmaster-only by Firestore rules. */}
            <div id="internal-agent-logs" className="mt-6 border-t border-border pt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5 text-muted-foreground" />
                  Internal agent logs
                </p>
                <span className="text-[11px] text-muted-foreground">
                  Last {Math.min(10, recentContacts.length) || 0} of 10
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mb-2">
                Local record of every Ping Webmaster action (call, text, or in-app alert).
              </p>
              {recentContacts.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3">
                  No entries yet — events appear here as agents tap Call, Text, or Ping.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border bg-muted/30">
                  {recentContacts.map((ev) => {
                    const when = ev.createdAt?.toDate ? ev.createdAt.toDate() : null;
                    const channelLabel =
                      ev.channel === "call"
                        ? "Called"
                        : ev.channel === "text"
                          ? "Texted"
                          : "Pinged";
                    const ChannelIcon =
                      ev.channel === "call"
                        ? PhoneCall
                        : ev.channel === "text"
                          ? MessageCircle
                          : Send;
                    return (
                      <li
                        key={ev.id}
                        className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs"
                      >
                        <Badge
                          variant={ev.channel === "call" ? "default" : "secondary"}
                          className="gap-1 shrink-0"
                        >
                          <ChannelIcon className="h-3 w-3" />
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
          <div id="bg-gmail" className="rounded-xl border border-border bg-card p-4 sm:p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-2">
              <Mail className="h-5 w-5 text-primary" />
              Background Gmail ingestion
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              When enabled, Kit TJ Services ClientHub silently polls your Gmail INBOX every ~2 minutes and pushes new messages into the Conversations queue. Pausing here stops polling without revoking your Google OAuth consent — flip it back on any time to resume.
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
        {/* Webmaster Slack alerts card removed — feature sunset. The
            webhook callable remains deployed but nothing in the UI fires it. */}
        {false && canEditWebhook && (
          <div id="webmaster-slack" />
        )}

        {/* Webmaster-only: Overview — at-a-glance assigned conversations per agent */}
        {isWebmaster && (
          <div id="overview" className="rounded-xl border border-border bg-card p-4 sm:p-6">
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

        {/* Promote-to-Webmaster panel removed — role management lives in
            the Accounts panel below (server-enforced). */}



        {isWebmaster && (
          <div id="pending" className="rounded-xl border border-border bg-card p-4 sm:p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-1">
              <Inbox className="h-5 w-5 text-primary" />
              Escalation requests
              {pendingCount > 0 && (
                <Badge variant="secondary" className="ml-1">{pendingCount}</Badge>
              )}
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Pending access requests and completed webmaster promotions are persisted in
              <code className="mx-1 rounded bg-muted px-1 py-0.5">escalationRequests</code>.
            </p>
            {pending.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No escalation entries yet.
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
                        <Badge variant={req.status === "pending" ? "secondary" : "outline"} className="capitalize text-[10px]">
                          {req.status}
                        </Badge>
                        {req.requestType === "role-promotion" && <Badge variant="outline" className="text-[10px]">Promotion</Badge>}
                      </div>
                      {req.requesterEmail && req.requesterName && (
                        <p className="text-xs text-muted-foreground truncate">{req.requesterEmail}</p>
                      )}
                      {req.targetIdentifier && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">Target: {req.targetIdentifier}</p>
                      )}
                      {req.reason && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">"{req.reason}"</p>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-1">{formatTime(req.createdAt)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 flex-shrink-0 sm:w-auto w-full">
                      {req.status === "pending" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 flex-1 sm:flex-none"
                            disabled={decidingId === req.id}
                            onClick={() => decide(req.id, "deny")}
                          >
                            <X className="h-3.5 w-3.5" /> Deny
                          </Button>
                          <Button
                            size="sm"
                            className="gap-1 flex-1 sm:flex-none"
                            disabled={decidingId === req.id}
                            onClick={() => decide(req.id, "approve")}
                          >
                            <Check className="h-3.5 w-3.5" />
                            {decidingId === req.id ? "…" : "Approve"}
                          </Button>
                        </>
                      )}
                      {req.status !== "resolved" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 flex-1 sm:flex-none"
                          disabled={managingId === req.id}
                          onClick={() => manageEscalation(req.id, "resolve")}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 flex-1 sm:flex-none"
                          disabled={managingId === req.id}
                          onClick={() => manageEscalation(req.id, "reopen")}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Reopen
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 flex-1 sm:flex-none"
                        disabled={managingId === req.id}
                        onClick={() => manageEscalation(req.id, "archive")}
                      >
                        <ArchiveIcon className="h-3.5 w-3.5" /> Archive
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
          <div id="agents" className="rounded-xl border border-border bg-card p-4 sm:p-6">
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
                          {acc.supportAccess && (
                            <Badge variant="outline" className="text-[10px] gap-1">
                              <LifeBuoy className="h-2.5 w-2.5" /> Support
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
                      <AccountActionsMenu
                        actions={[
                          {
                            key: "rename",
                            label: "Rename",
                            icon: <Pencil className="h-3.5 w-3.5" />,
                            onClick: () => openRename(acc),
                          },
                          isAdminTier
                            ? {
                                key: "demote",
                                label: busy ? "…" : "Demote to agent",
                                icon: <ArrowDown className="h-3.5 w-3.5" />,
                                disabled: busy,
                                onClick: () => demoteToAgent(acc),
                              }
                            : {
                                key: "promote",
                                label: busy ? "…" : "Promote to admin",
                                icon: <ArrowUp className="h-3.5 w-3.5" />,
                                disabled: busy,
                                onClick: () => promoteAgentToAdmin(acc),
                              },
                        ]}
                      />
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

        {/* Signup verification — webmaster + admin */}
        <SignupApprovalsPanel />
        <AgentRosterPanel />
        {isWebmaster && <AuthorizedDomainsPanel />}
        {isWebmaster && <DataSeedPanel />}

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
          <div id="accounts" className="rounded-xl border border-border bg-card p-4 sm:p-6">
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
                        {acc.supportAccess && (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <LifeBuoy className="h-2.5 w-2.5" /> Support
                          </Badge>
                        )}
                        {isSelf && <Badge variant="outline" className="text-[10px]">You</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{acc.email || acc.uid}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Joined {formatTime(acc.createdAt)}</p>
                      {/* Password row (encrypted webmaster vault). Plaintext
                          is decrypted in-browser only when the vault is
                          unlocked with the webmaster passphrase. */}
                      {(() => {
                        const hasEntry = !!vaultEntries[acc.uid];
                        const plain = vaultPlain[acc.uid] ?? null;
                        const revealed = revealedUid === acc.uid && !!plain;
                        return (
                          <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                            <KeyRound className="h-3 w-3 text-muted-foreground" />
                            <span className="text-muted-foreground">Password:</span>
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                              {hasEntry
                                ? revealed
                                  ? plain
                                  : vaultUnlocked
                                  ? "••••••••••"
                                  : "🔒 vault locked"
                                : "(not set via vault)"}
                            </code>
                            {hasEntry && vaultUnlocked && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => revealPassword(acc.uid)}
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
                              {hasEntry ? "Change" : "Set"}
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                    <AccountActionsMenu
                      actions={[
                        // Promote / Demote — webmaster-only role flips. Hidden
                        // for self and for existing webmasters (the latter
                        // must be demoted via promoteToWebmaster role=admin
                        // first to satisfy the demoteAgent precondition).
                        {
                          key: "promote",
                          label: roleChangingUid === acc.uid ? "Promoting…" : "Promote to admin",
                          icon: <ArrowUp className="h-3.5 w-3.5" />,
                          disabled: roleChangingUid === acc.uid,
                          hidden: isSelf || acc.role === "webmaster" || acc.role !== "agent",
                          onClick: () => promoteAgentToAdmin(acc),
                        },
                        {
                          key: "demote",
                          label: roleChangingUid === acc.uid ? "Demoting…" : "Demote to agent",
                          icon: <ArrowDown className="h-3.5 w-3.5" />,
                          disabled: roleChangingUid === acc.uid,
                          hidden: isSelf || acc.role === "webmaster" || acc.role === "agent",
                          onClick: () => demoteToAgent(acc),
                        },
                        // Grant / Revoke Support — webmaster-only.
                        {
                          key: "grant-support",
                          label: supportChangingUid === acc.uid ? "Updating…" : "Grant Support",
                          icon: <LifeBuoy className="h-3.5 w-3.5" />,
                          disabled: supportChangingUid === acc.uid,
                          hidden: isSelf || !!acc.supportAccess,
                          onClick: () => setSupportAccessFor(acc, true),
                        },
                        {
                          key: "revoke-support",
                          label: supportChangingUid === acc.uid ? "Updating…" : "Revoke Support",
                          icon: <LifeBuoy className="h-3.5 w-3.5" />,
                          disabled: supportChangingUid === acc.uid,
                          hidden: isSelf || !acc.supportAccess,
                          onClick: () => setSupportAccessFor(acc, false),
                        },
                        {
                          key: "revoke-escalation",
                          label: revokingUid === acc.uid ? "Revoking…" : "Revoke escalation",
                          icon: <ShieldOff className="h-3.5 w-3.5" />,
                          disabled: revokingUid === acc.uid,
                          hidden: !(acc.escalatedAccess && acc.role !== "webmaster"),
                          onClick: () => {
                            setRevokeReason("");
                            setRevokeDialogUid(acc.uid);
                          },
                        },
                        {
                          key: "delete",
                          label: deletingUid === acc.uid ? "Deleting…" : "Delete",
                          icon: <Trash2 className="h-3.5 w-3.5" />,
                          destructive: true,
                          disabled: isSelf || deletingUid === acc.uid,
                          hidden: isSelf,
                          onClick: () => setDeleteDialogUid(acc.uid),
                        },
                      ]}
                    />
                  </div>
                );
              })}
              {accounts.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No accounts yet.
                </div>
              )}
              {/* Shared delete-confirmation dialog — controlled via
                  deleteDialogUid so both the desktop inline Delete button
                  and the mobile ⋯ menu open the same dialog. */}
              <AlertDialog
                open={!!deleteDialogUid}
                onOpenChange={(o) => {
                  if (!o) setDeleteDialogUid(null);
                }}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this account?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {(() => {
                        const target = accounts.find((a) => a.uid === deleteDialogUid);
                        const who = target?.email || target?.displayName || target?.uid || "this user";
                        return `This permanently removes ${who} from Firebase Auth and Firestore. They will lose access immediately and cannot sign in again.`;
                      })()}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => {
                        const target = accounts.find((a) => a.uid === deleteDialogUid);
                        if (target) deleteAccount(target.uid, target.email);
                        setDeleteDialogUid(null);
                      }}
                    >
                      Delete account
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
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
                  Updates Firebase Auth immediately. The plaintext is{" "}
                  <strong>encrypted in your browser</strong> with your vault passphrase
                  (AES-GCM-256 / PBKDF2) and only the ciphertext is written to{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[11px]">managedPasswords/{pwDialogUid ?? "{uid}"}</code>.
                  No plaintext leaves this device.
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

        {/* Webmaster-only: Vault unlock / initialize dialog */}
        {isWebmaster && (
          <Dialog
            open={vaultDialogOpen}
            onOpenChange={(o) => {
              if (!o) {
                setVaultDialogOpen(false);
                setVaultPassphrase("");
                setVaultPassphraseConfirm("");
                setVaultError(null);
                setVaultStep("idle");
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-primary" />
                  {isVaultInitialized ? "Unlock password vault" : "Initialize password vault"}
                </DialogTitle>
                <DialogDescription>
                  {isVaultInitialized
                    ? "Enter your vault passphrase to decrypt managed passwords. The passphrase is held in this tab's memory only and never persisted to disk."
                    : "Pick a strong passphrase. It derives an AES-GCM-256 key via PBKDF2 (200,000 iterations) and is never sent to the server. If you lose it, every stored password must be re-set — there is no recovery."}
                </DialogDescription>
              </DialogHeader>

              {!isVaultInitialized && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div className="space-y-1">
                      <p className="font-medium">Before you continue</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        <li>Use at least 14 characters with mixed case, numbers and a symbol.</li>
                        <li>Store it in a separate password manager — it cannot be reset.</li>
                        <li>Anyone with this passphrase can decrypt every managed password.</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="vault-passphrase">Passphrase</Label>
                  <Input
                    id="vault-passphrase"
                    type="password"
                    value={vaultPassphrase}
                    onChange={(e) => { setVaultPassphrase(e.target.value); setVaultError(null); }}
                    placeholder="At least 8 characters"
                    autoFocus
                    disabled={vaultBusy}
                  />
                  {!isVaultInitialized && vaultPassphrase.length > 0 && (() => {
                    const s = passphraseStrength(vaultPassphrase);
                    return (
                      <div className="space-y-1">
                        <Progress value={s.score} className="h-1.5" />
                        <p className="text-[11px] text-muted-foreground">Strength: <span className="font-medium text-foreground">{s.label}</span></p>
                      </div>
                    );
                  })()}
                </div>

                {!isVaultInitialized && (
                  <div className="space-y-1.5">
                    <Label htmlFor="vault-passphrase-confirm">Confirm passphrase</Label>
                    <Input
                      id="vault-passphrase-confirm"
                      type="password"
                      value={vaultPassphraseConfirm}
                      onChange={(e) => { setVaultPassphraseConfirm(e.target.value); setVaultError(null); }}
                      disabled={vaultBusy}
                    />
                    {vaultPassphraseConfirm.length > 0 && vaultPassphrase !== vaultPassphraseConfirm && (
                      <p className="text-[11px] text-destructive">Passphrases do not match yet.</p>
                    )}
                  </div>
                )}

                {vaultBusy && (
                  <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {vaultStep === "deriving" && "Deriving key (PBKDF2, 200k iterations)…"}
                    {vaultStep === "writing" && "Writing encrypted sentinel to Firestore…"}
                    {vaultStep === "done" && "Vault ready."}
                  </div>
                )}

                {vaultStep === "done" && !vaultBusy && (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" /> Vault {isVaultInitialized ? "unlocked" : "initialized"} successfully.
                  </div>
                )}

                {vaultError && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2" role="alert">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>{vaultError}</span>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setVaultDialogOpen(false)} disabled={vaultBusy}>
                  Cancel
                </Button>
                <Button
                  onClick={handleVaultUnlock}
                  disabled={
                    vaultBusy ||
                    vaultPassphrase.length < 8 ||
                    (!isVaultInitialized && vaultPassphrase !== vaultPassphraseConfirm)
                  }
                  className="gap-1.5"
                >
                  {vaultBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  {vaultBusy ? "Working…" : isVaultInitialized ? "Unlock vault" : "Initialize vault"}
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
          <div id="investigations" className="rounded-xl border border-border bg-card p-4 sm:p-6">
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
              Conversations flagged by admins for webmaster review. Each entry is fanned out to every
              webmaster's in-app notification bell in real time.
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
                : `Your admin account doesn't have access to Integrations, Analytics, or the Gmail API. Request escalation and every webmaster will see it in their in-app notifications.`}
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
                  Posted to every webmaster's notifications bell — they'll see it on next sign-in if they're offline now.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Security panel removed — Firebase auth + server-side role
            enforcement are documented in the project README. */}

      </div>
      </div>
    </div>
  );
};

export default SettingsPage;
