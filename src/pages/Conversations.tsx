import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Plus,
  Phone,
  MessageSquare,
  Mail,
  User,
  ChevronRight,
  Download,
  Copy,
  FileText,
  FileSpreadsheet,
  PackageOpen,
  Filter,
  X,
  UserCheck,
  Keyboard,
  ArrowLeft,
  Trash2,
  RotateCcw,
  Tag,
  Radio,
  Archive as ArchiveIcon,
  ShieldAlert,
  MoreHorizontal,
  Link2,
  Share2,
  Users as UsersIcon,
  Footprints,
  CheckCircle2,
  Mic,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import PullToRefresh from "@/components/PullToRefresh";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSupportUsers, isSupportByName, isSupportByEmail } from "@/hooks/useSupportUsers";
import { SupportBadge } from "@/components/SupportBadge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { restoreItem } from "@/lib/softDelete";
import { getBoolPref, setBoolPref } from "@/lib/userPrefs";
import { subscribeLocalAgents } from "@/lib/localAgents";
import { Switch } from "@/components/ui/switch";
import NewConversationDialog from "@/components/NewConversationDialog";
import ConversationTemplates, { type MessageTemplate } from "@/components/ConversationTemplates";
import EditPersonDialog, { type EditablePerson } from "@/components/EditPersonDialog";
import ExtractSearch from "@/components/ExtractSearch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { httpsCallable } from "firebase/functions";
import { useSearchParams, useParams, useNavigate } from "react-router-dom";
import { functions } from "@/lib/firebase";
import ConversationNotes from "@/components/ConversationNotes";
import CallRecorder from "@/components/CallRecorder";
import { useConversationNoteCounts } from "@/hooks/useConversationNoteCounts";
import { StickyNote } from "lucide-react";
import SlackAlertButton from "@/components/SlackAlertButton";
import RecordingPlayerDialog from "@/components/RecordingPlayerDialog";
import { listConversationRecordings, type CallRecordingDoc } from "@/lib/callRecordings";
import {
  buildSlackSlugIndex,
  slugifyConversationName,
} from "@/lib/conversationSlugs";

interface Conversation {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  lastMessage: string;
  channel: "sms" | "phone" | "email" | "slack" | "mobile";
  timestamp: any;
  unread: boolean;
  status: "active" | "waiting" | "resolved";
  assignedAgent?: string;
  archived?: boolean;
  deletedAt?: any;
}

interface ConversationMessage {
  id: string;
  conversationId: string;
  sender: "customer" | "agent";
  text: string;
  timestamp: any;
  channel: "sms" | "phone" | "email" | "slack" | "mobile";
  sourceDocName?: string;
  sourceDocTruncated?: boolean;
  extractText?: string;
}

const channelIcons = {
  sms: <MessageSquare className="h-3.5 w-3.5" />,
  phone: <Phone className="h-3.5 w-3.5" />,
  email: <Mail className="h-3.5 w-3.5" />,
  slack: <MessageSquare className="h-3.5 w-3.5" />,
  // "Mobile" = activity that originates from someone literally on the move
  // (e.g. an agent capturing a thread in the field). Footprints conveys the
  // "someone running" feel without needing a custom asset.
  mobile: <Footprints className="h-3.5 w-3.5" />,
};

const CheckIcon = () => <CheckCircle2 className="h-3.5 w-3.5" />;

const statusColors = {
  active: "bg-success text-success-foreground",
  waiting: "bg-warning text-warning-foreground",
  resolved: "bg-muted text-muted-foreground",
};

const fallbackConversations: Conversation[] = [
  { id: "mock-1", customerName: "Sarah Mitchell", customerEmail: "sarah@example.com", customerPhone: "+15550101", lastMessage: "Thanks for helping me with the billing issue!", channel: "email", timestamp: null, unread: true, status: "active" },
  { id: "mock-2", customerName: "James Rodriguez", customerEmail: "james@example.com", customerPhone: "+15550102", lastMessage: "Can I get an update on my order?", channel: "sms", timestamp: null, unread: true, status: "waiting" },
  { id: "mock-3", customerName: "Emily Chen", customerEmail: "emily@example.com", customerPhone: "+15550103", lastMessage: "The issue has been resolved, thank you!", channel: "phone", timestamp: null, unread: false, status: "resolved" },
  { id: "mock-4", customerName: "Michael Brown", customerEmail: "michael@example.com", customerPhone: "+15550104", lastMessage: "I need help with my subscription cancellation.", channel: "slack", timestamp: null, unread: false, status: "active" },
];

const fallbackMessages: ConversationMessage[] = [
  { id: "m1", conversationId: "mock-1", sender: "customer", text: "Hi, I have a question about my recent bill.", timestamp: null, channel: "email" },
  { id: "m2", conversationId: "mock-1", sender: "agent", text: "Of course! I'd be happy to help. Could you share your account number?", timestamp: null, channel: "email" },
  { id: "m3", conversationId: "mock-1", sender: "customer", text: "Sure, it's ACC-29481.", timestamp: null, channel: "email" },
  { id: "m4", conversationId: "mock-1", sender: "agent", text: "Thank you Sarah. I can see a $24.99 charge from March 15. This was for the premium plan upgrade.", timestamp: null, channel: "email" },
  { id: "m5", conversationId: "mock-1", sender: "customer", text: "Oh I see! Thanks for helping me with the billing issue!", timestamp: null, channel: "email" },
];

function formatTimestamp(ts: any): string {
  if (!ts) return "";
  if (ts?.toDate) {
    const d = ts.toDate();
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hr ago`;
    return d.toLocaleDateString();
  }
  return String(ts);
}

function formatMessageTime(ts: any): string {
  if (!ts) return "";
  if (ts?.toDate) {
    return ts.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return String(ts);
}

function formatFullTimestamp(ts: any): string {
  if (!ts) return "N/A";
  if (ts?.toDate) return ts.toDate().toLocaleString();
  return String(ts);
}

// ---------- Export helpers ----------

function buildTranscript(convo: Conversation, msgs: ConversationMessage[]) {
  const lines = [
    `Conversation Transcript`,
    `Customer: ${convo.customerName} (${convo.customerEmail})`,
    `Channel: ${convo.channel.toUpperCase()}`,
    `Status: ${convo.status}`,
    `Exported: ${new Date().toLocaleString()}`,
    `${"—".repeat(40)}`,
    "",
  ];
  msgs.forEach((msg) => {
    const time = formatMessageTime(msg.timestamp) || "N/A";
    const sender = msg.sender === "agent" ? "Agent" : convo.customerName;
    lines.push(`[${time}] ${sender}: ${msg.text}`);
  });
  return lines.join("\n");
}

function buildCSV(convo: Conversation, msgs: ConversationMessage[]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [["Timestamp", "Sender", "Channel", "Message"].join(",")];
  msgs.forEach((msg) => {
    rows.push(
      [
        escape(formatFullTimestamp(msg.timestamp)),
        escape(msg.sender === "agent" ? "Agent" : convo.customerName),
        escape(msg.channel),
        escape(msg.text),
      ].join(",")
    );
  });
  return rows.join("\n");
}

/**
 * SECURITY: HTML-escape every value before interpolating into the export markup.
 * Without this, Firestore-supplied fields (customerName, message text, etc.)
 * could inject <script> tags that execute in the popup with same-origin access.
 */
function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPDFHTML(convo: Conversation, msgs: ConversationMessage[]): string {
  const msgRows = msgs
    .map(
      (msg) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${escHtml(formatFullTimestamp(msg.timestamp))}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${escHtml(msg.sender === "agent" ? "Agent" : convo.customerName)}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${escHtml(msg.text)}</td></tr>`
    )
    .join("");
  return `<html><head><style>body{font-family:Arial,sans-serif;padding:32px;color:#1a1a1a}h1{font-size:18px;margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:16px}th{text-align:left;padding:8px;background:#f3f4f6;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #d1d5db}</style></head><body><h1>Conversation Transcript</h1><p style="margin:4px 0;font-size:13px;color:#6b7280">Customer: ${escHtml(convo.customerName)} (${escHtml(convo.customerEmail)})<br/>Channel: ${escHtml(convo.channel.toUpperCase())} · Status: ${escHtml(convo.status)}<br/>Exported: ${escHtml(new Date().toLocaleString())}</p><table><thead><tr><th>Time</th><th>Sender</th><th>Message</th></tr></thead><tbody>${msgRows}</tbody></table></body></html>`;
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadPDF(html: string, filename: string) {
  const win = window.open("", "_blank");
  if (!win) {
    toast({ title: "Popup blocked", description: "Allow popups to download PDF.", variant: "destructive" });
    return;
  }
  win.document.write(html);
  win.document.close();
  setTimeout(() => {
    win.print();
  }, 400);
}

const Conversations: React.FC = () => {
  const { profile, user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [allMessages, setAllMessages] = useState<Record<string, ConversationMessage[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [replyText, setReplyText] = useState("");
  const [usingFallback, setUsingFallback] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [elevateOpen, setElevateOpen] = useState(false);
  const [elevateReason, setElevateReason] = useState("");
  const [elevating, setElevating] = useState(false);
  const [recordingsList, setRecordingsList] = useState<CallRecordingDoc[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [recordingsListOpen, setRecordingsListOpen] = useState(false);
  const [playerRecording, setPlayerRecording] = useState<CallRecordingDoc | null>(null);

  // Role-based permission helpers used to enable/disable & explain header actions.
  const role = profile?.role ?? "agent";
  const isPrivileged = role === "admin" || role === "webmaster";
  const perms = {
    canAssignAgent: isPrivileged,
    canArchive: isPrivileged,
    canRestore: isPrivileged,
    // Everyone can view recordings of conversations they can access (server-side
    // signed-URL function still enforces ownership/role).
    canViewRecordings: true,
  };
  const denyTip = (action: string) =>
    `${action} is restricted to admins and webmasters. Ask your team lead for elevated access.`;

  const submitElevation = async () => {
    if (!selected) return;
    setElevating(true);
    try {
      const fn = httpsCallable<
        { conversationId: string; customerName: string; reason: string },
        {
          ok: boolean;
          notified?: number;
          notifyError?: string | null;
          delivered?: boolean;
        }
      >(functions, "requestConversationInvestigation");
      const res = await fn({
        conversationId: selected.id,
        customerName: selected.customerName,
        reason: elevateReason,
      });
      const notified = res.data.notified ?? 0;
      const title = notified > 0 ? "Webmaster notified" : "Investigation request logged";
      const description =
        notified > 0
          ? `Posted to ${notified} webmaster bell${notified === 1 ? "" : "s"} — they'll review shortly.`
          : res.data.notifyError ||
            "Request recorded; no webmasters were online to notify just now.";
      toast({
        title,
        description,
        variant: notified === 0 ? "destructive" : undefined,
      });
      setElevateOpen(false);
      setElevateReason("");
    } catch (e: any) {
      toast({ title: "Could not send request", description: e?.message, variant: "destructive" });
    } finally {
      setElevating(false);
    }
  };
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [showShortcuts, setShowShortcuts] = useState(false);
  // "Show only my assigned conversations" filter for agents/admins.
  const [mineOnly, setMineOnly] = useState<boolean>(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // Persist 'Show archived' across refresh, namespaced per Firebase UID.
  const [showArchived, setShowArchivedState] = useState<boolean>(false);
  useEffect(() => {
    setShowArchivedState(getBoolPref(user?.uid, "conversations.showArchived", false));
  }, [user?.uid]);
  const setShowArchived = (v: boolean) => {
    setShowArchivedState(v);
    setBoolPref(user?.uid, "conversations.showArchived", v);
  };
  const replyInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const supportUsers = useSupportUsers();

  // Note: the previous resizable thread-list pane was removed in favor of an
  // overlay layout — selecting a conversation now hides the list and shows
  // the detail full-width on every viewport (mobile-style on desktop too).
  const [searchParams, setSearchParams] = useSearchParams();
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Live list of agent display names — must match exactly what the Agents page
  // shows. Sources: (1) Firestore `users` with role agent/admin and (2) the
  // manually-added local roster (localStorage). No more hardcoded fallback —
  // if Firestore is unreachable we still surface local agents so demo data
  // works, but we never invent fake names that don't exist on /agents.
  const [firestoreAgents, setFirestoreAgents] = useState<string[]>([]);
  const [localAgentNames, setLocalAgentNames] = useState<string[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const names = snap.docs
          .map((d) => d.data() as any)
          .filter((u) => u && (u.role === "agent" || u.role === "admin") && (u.displayName || u.email))
          .map((u) => (u.displayName || u.email) as string)
          .filter((v, i, arr) => arr.indexOf(v) === i);
        setFirestoreAgents(names);
      },
      () => setFirestoreAgents([])
    );
    return unsub;
  }, []);
  useEffect(() => {
    return subscribeLocalAgents((rows) =>
      setLocalAgentNames(rows.map((r) => r.displayName).filter(Boolean))
    );
  }, []);
  const agents = useMemo(() => {
    const set = new Set<string>([...firestoreAgents, ...localAgentNames]);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [firestoreAgents, localAgentNames]);

  const handleRefresh = async () => {
    await new Promise((r) => setTimeout(r, 600));
    toast({ title: "Refreshed", description: "Conversations are up to date." });
  };


  // Single-listener map of conversation → note count, used to render the
  // "N notes" badge on each row in the list and on /agent-logs row headers.
  const noteCounts = useConversationNoteCounts();

  // Single conversation export handlers
  const selected = conversations.find((c) => c.id === selectedId);

  // Per-agent open-load count: conversations that are assigned and not resolved.
  // Used to show a dot + count in the assign-agent dropdown so it's easy to
  // spot who's already overloaded before assigning more work.
  const agentLoad = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of conversations) {
      if (c.archived) continue;
      if (c.status === "resolved") continue;
      if (!c.assignedAgent) continue;
      map.set(c.assignedAgent, (map.get(c.assignedAgent) ?? 0) + 1);
    }
    return map;
  }, [conversations]);

  // Slug index for Slack-channel conversations only. Lets users bookmark
  // /conversations#back-end-automation-test as a stable, human-readable
  // alternative to the canonical /conversations/:id URL. Built once per
  // conversations snapshot — cheap (O(n) over the existing list).
  const slackSlugs = useMemo(() => buildSlackSlugIndex(conversations), [conversations]);

  // Share/copy a deep link to the currently-selected conversation.
  // For Slack-channel threads, prefers the slug-hash form (matches the
  // bookmark format users have asked us to support); falls back to the
  // canonical /:id URL for other channels or when the slug collides.
  // Prefers the native Web Share API (mobile share sheet) when available;
  // falls back to clipboard on desktop browsers without share support.
  const handleCopyLink = async () => {
    if (!selected) return;
    let url = `${window.location.origin}/conversations/${selected.id}`;
    if (selected.channel === "slack") {
      const slug = slugifyConversationName(selected.customerName);
      const owner = slug ? slackSlugs.bySlug.get(slug) : null;
      // Only hand out the hash form when this conversation owns the slug —
      // never produce a link that would resolve to a sibling thread.
      if (slug && owner && owner.id === selected.id) {
        url = `${window.location.origin}/conversations#${slug}`;
      }
    }
    const title = `Conversation with ${selected.customerName}`;
    const shareData: ShareData = {
      title,
      text: `${title} on ConvoHub`,
      url,
    };
    // Web Share API: only use when the browser can actually share this payload.
    // `canShare` guards against desktop Chrome which exposes `share` but rejects URLs.
    const canNativeShare =
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      (typeof navigator.canShare !== "function" || navigator.canShare(shareData));
    if (canNativeShare) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err: any) {
        // User dismissed the share sheet — don't fall through to clipboard.
        if (err?.name === "AbortError") return;
        // Any other error (e.g. permission denied): fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: "Conversation URL copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: url, variant: "destructive" });
    }
  };

  const handleCopyTranscript = () => {
    if (!selected || messages.length === 0) return;
    navigator.clipboard.writeText(buildTranscript(selected, messages)).then(() => {
      toast({ title: "Copied", description: "Transcript copied to clipboard." });
    });
  };

  const handleDownloadTXT = () => {
    if (!selected) return;
    downloadFile(buildTranscript(selected, messages), `transcript-${selected.customerName.replace(/\s+/g, "-").toLowerCase()}.txt`, "text/plain");
    toast({ title: "Downloaded", description: "Transcript saved as TXT." });
  };

  const handleDownloadCSV = () => {
    if (!selected) return;
    downloadFile(buildCSV(selected, messages), `transcript-${selected.customerName.replace(/\s+/g, "-").toLowerCase()}.csv`, "text/csv");
    toast({ title: "Downloaded", description: "Transcript saved as CSV." });
  };

  const handleDownloadPDF = () => {
    if (!selected) return;
    downloadPDF(buildPDFHTML(selected, messages), `transcript-${selected.customerName.replace(/\s+/g, "-").toLowerCase()}.pdf`);
  };

  // Bulk export all conversations
  const handleBulkExport = async (format: "txt" | "csv") => {
    toast({ title: "Preparing bulk export…", description: "Fetching all conversations." });
    try {
      const allParts: string[] = [];
      for (const convo of conversations) {
        let msgs: ConversationMessage[] = [];
        if (usingFallback) {
          msgs = fallbackMessages.filter((m) => m.conversationId === convo.id);
        } else {
          const q = query(collection(db, "conversations", convo.id, "messages"), orderBy("timestamp", "asc"));
          const snap = await getDocs(q);
          msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ConversationMessage));
        }
        if (format === "txt") {
          allParts.push(buildTranscript(convo, msgs));
          allParts.push("\n\n" + "=".repeat(60) + "\n\n");
        } else {
          if (allParts.length === 0) {
            allParts.push("Customer,Email,Timestamp,Sender,Channel,Message");
          }
          msgs.forEach((msg) => {
            const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
            allParts.push(
              [escape(convo.customerName), escape(convo.customerEmail), escape(formatFullTimestamp(msg.timestamp)), escape(msg.sender === "agent" ? "Agent" : convo.customerName), escape(msg.channel), escape(msg.text)].join(",")
            );
          });
        }
      }
      const mime = format === "csv" ? "text/csv" : "text/plain";
      downloadFile(allParts.join("\n"), `all-transcripts-${Date.now()}.${format}`, mime);
      toast({ title: "Bulk export complete", description: `${conversations.length} conversations exported as ${format.toUpperCase()}.` });
    } catch (e) {
      console.error("Bulk export error:", e);
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  // Call client from profile
  const handleCallClient = () => {
    const phone = selected?.customerPhone;
    if (!phone) {
      toast({ title: "No phone number", description: "This client has no phone number on file.", variant: "destructive" });
      return;
    }
    window.open(`tel:${phone}`, "_self");
  };

  useEffect(() => {
    const q = query(collection(db, "conversations"), orderBy("timestamp", "desc"));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const requestedOpen = searchParams.get("open") || routeId;
        if (snapshot.empty) {
          setConversations(fallbackConversations);
          setUsingFallback(true);
          setSelectedId(requestedOpen || null);
        } else {
          const convos = snapshot.docs.map(
            (d) => ({ id: d.id, ...d.data() } as Conversation)
          );
          setConversations(convos);
          setUsingFallback(false);
          // Honor /conversations/:id or ?open=<id> deep link if it matches a real conversation.
          if (requestedOpen && convos.find((c) => c.id === requestedOpen)) {
            setSelectedId(requestedOpen);
          } else if (!routeId) {
            // Only auto-select on the index route — never override an explicit URL.
            const visible = convos.filter((c) => (showArchived ? c.archived : !c.archived));
            if (!selectedId || !visible.find((c) => c.id === selectedId)) {
              setSelectedId(null);
            }
          }
        }
      },
      (error) => {
        console.error("Conversations listener error:", error);
        setConversations(fallbackConversations);
        setUsingFallback(true);
        setSelectedId(routeId || null);
      }
    );
    return unsub;
  }, [routeId]);

  // Keep the URL in sync with the currently-selected conversation so reloads
  // and shared links re-open the same thread. Skip when nothing is selected
  // (we want the index route to remain "/", not "/conversations/").
  useEffect(() => {
    if (!selectedId) {
      if (routeId) navigate("/conversations", { replace: true });
      return;
    }
    if (selectedId !== routeId) {
      navigate(`/conversations/${selectedId}`, { replace: true });
    }
  }, [selectedId, routeId, navigate]);

  // Honor ?open=<conversationId> deep link, then strip the param so refreshes don't re-trigger.
  useEffect(() => {
    const requestedOpen = searchParams.get("open");
    if (!requestedOpen) return;
    const target = conversations.find((c) => c.id === requestedOpen);
    if (target) {
      // If the target is archived but the Show archived toggle is off, flip it
      // on so the conversation appears in the list (not just the detail pane).
      if (target.archived && !showArchived) {
        setShowArchived(true);
        toast({
          title: "Showing archived",
          description: "Switched to archived view to surface this conversation.",
        });
      }
      setSelectedId(requestedOpen);
      // Clear the param so navigating away/back doesn't pin the selection.
      const next = new URLSearchParams(searchParams);
      next.delete("open");
      setSearchParams(next, { replace: true });
      toast({ title: "Conversation opened", description: "Linked from Investigation requests." });
    }
  }, [conversations, searchParams, setSearchParams, showArchived]);

  // Honor #<slug> deep links — Slack-channel conversations only. Resolves
  // the slug against the current Slack-slug index, opens the matching
  // thread, and warns when the slug is ambiguous (two threads share the
  // same customer name) so the user knows to use the canonical /:id URL.
  // Re-runs on hashchange so back/forward navigation works as expected.
  useEffect(() => {
    const tryResolveHash = () => {
      const raw = window.location.hash.replace(/^#/, "").trim().toLowerCase();
      if (!raw) return;
      // Already on the right thread — nothing to do.
      const current = conversations.find((c) => c.id === selectedId);
      if (current && slugifyConversationName(current.customerName) === raw) return;

      if (slackSlugs.duplicateSlugs.has(raw)) {
        toast({
          title: "Ambiguous link",
          description: `Multiple Slack conversations share the slug "${raw}". Use the full /conversations/<id> link instead.`,
          variant: "destructive",
        });
        return;
      }
      const target = slackSlugs.bySlug.get(raw);
      if (!target) return;
      const archived = (target as any).archived === true;
      if (archived && !showArchived) {
        setShowArchived(true);
        toast({
          title: "Showing archived",
          description: "Switched to archived view to surface this conversation.",
        });
      }
      setSelectedId(target.id);
    };
    tryResolveHash();
    window.addEventListener("hashchange", tryResolveHash);
    return () => window.removeEventListener("hashchange", tryResolveHash);
  }, [conversations, slackSlugs, selectedId, showArchived, setShowArchived]);

  // When a Slack-channel conversation is selected, mirror its slug into
  // window.location.hash so the user can copy the URL bar verbatim as a
  // bookmark. Non-Slack channels (and slug-collisions) clear the hash
  // back to nothing — the canonical /:id URL is enough on its own.
  useEffect(() => {
    if (!selected) return;
    const desired =
      selected.channel === "slack"
        ? (() => {
            const slug = slugifyConversationName(selected.customerName);
            const owner = slug ? slackSlugs.bySlug.get(slug) : null;
            return slug && owner && owner.id === selected.id ? `#${slug}` : "";
          })()
        : "";
    if (window.location.hash === desired) return;
    // Use replaceState so we don't pollute browser history with one entry
    // per selection change.
    const url = `${window.location.pathname}${window.location.search}${desired}`;
    window.history.replaceState(window.history.state, "", url);
  }, [selected, slackSlugs]);

  // Real-time messages listener for selected conversation
  useEffect(() => {
    if (!selectedId) return;
    if (usingFallback) {
      setMessages(fallbackMessages.filter((m) => m.conversationId === selectedId));
      return;
    }
    const q = query(collection(db, "conversations", selectedId, "messages"), orderBy("timestamp", "asc"));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const msgs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as ConversationMessage));
        setMessages(msgs);
        setAllMessages((prev) => ({ ...prev, [selectedId]: msgs }));
      },
      (error) => {
        console.error("Messages listener error:", error);
        setMessages([]);
      }
    );
    return unsub;
  }, [selectedId, usingFallback]);

  // Cache fallback messages for search
  useEffect(() => {
    if (usingFallback) {
      const cache: Record<string, ConversationMessage[]> = {};
      fallbackConversations.forEach((c) => {
        cache[c.id] = fallbackMessages.filter((m) => m.conversationId === c.id);
      });
      setAllMessages(cache);
    }
  }, [usingFallback]);

  // The agent name as it appears on conversations.assignedAgent — matches what
  // the assign dropdown writes (displayName preferred, falling back to email).
  const myAgentName = (profile?.displayName?.trim() || profile?.email?.trim() || "").toLowerCase();
  const myOpenCount = useMemo(() => {
    if (!myAgentName) return 0;
    return conversations.filter(
      (c) =>
        !c.archived &&
        c.status !== "resolved" &&
        (c.assignedAgent || "").toLowerCase() === myAgentName
    ).length;
  }, [conversations, myAgentName]);
  // Hide banner+filter for webmasters (they have the Overview panel instead).
  const showMineBanner = profile?.role !== "webmaster" && myOpenCount > 0;

  const filtered = conversations.filter((c) => {
    const archivedMatch = showArchived ? !!c.archived : !c.archived;
    if (!archivedMatch) return false;
    // Resolved conversations live on the dedicated /agent-logs page, not here.
    // We still allow them through when the user is viewing the archive (since
    // archived items can be resolved too) so that view stays a complete record.
    if (!showArchived && c.status === "resolved") return false;
    if (mineOnly && (c.assignedAgent || "").toLowerCase() !== myAgentName) return false;
    const lowerSearch = search.toLowerCase();
    const matchesBasic =
      c.customerName.toLowerCase().includes(lowerSearch) ||
      c.lastMessage.toLowerCase().includes(lowerSearch);
    // Full-text search across cached message contents
    const matchesMessages = !matchesBasic && search.length >= 2 &&
      (allMessages[c.id] || []).some((m) => m.text.toLowerCase().includes(lowerSearch));
    const matchesSearch = matchesBasic || matchesMessages;
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    const matchesChannel = channelFilter === "all" || c.channel === channelFilter;
    return matchesSearch && matchesStatus && matchesChannel;
  });

  const handleInsertTemplate = (template: MessageTemplate) => {
    const filled = template.body
      .replace(/\{\{name\}\}/g, selected?.customerName || "Customer")
      .replace(/\{\{agent\}\}/g, profile?.displayName || "Agent")
      .replace(/\{\{company\}\}/g, "ConvoHub");
    setReplyText(filled);
  };

  const hasActiveFilters = statusFilter !== "all" || channelFilter !== "all";
  const clearFilters = () => { setStatusFilter("all"); setChannelFilter("all"); };

  const handleAssignAgent = async (convoId: string, agent: string | null) => {
    // Optimistic update
    setConversations((prev) =>
      prev.map((c) => (c.id === convoId ? { ...c, assignedAgent: agent || undefined } : c))
    );
    if (!usingFallback) {
      try {
        await updateDoc(doc(db, "conversations", convoId), {
          assignedAgent: agent ?? null,
        });
      } catch (e) {
        console.error("Failed to persist agent assignment:", e);
        toast({ title: "Could not save assignment", description: "Change is local only.", variant: "destructive" });
      }
    }
    toast({
      title: agent ? "Assigned" : "Unassigned",
      description: agent ? `Conversation assigned to ${agent}.` : "Agent removed from conversation.",
    });
  };

  const handleToggleResolved = async () => {
    if (!selectedId || !selected) return;
    const newStatus = selected.status === "resolved" ? "active" : "resolved";
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, status: newStatus as any } : c))
    );
    if (!usingFallback) {
      try {
        // Stamp resolvedAt/resolvedBy when closing so /agent-logs metrics
        // (avg time-to-resolve, resolved-this-week) have a real timestamp
        // to compute against. Clear both fields on reopen so a future
        // re-resolve gets a fresh duration measurement.
        const patch: Record<string, unknown> = { status: newStatus };
        if (newStatus === "resolved") {
          patch.resolvedAt = serverTimestamp();
          patch.resolvedBy =
            profile?.displayName || profile?.email || selected.assignedAgent || null;
        } else {
          // Use sentinel-style nulls so listeners see the field disappear from UI calcs.
          patch.resolvedAt = null;
          patch.resolvedBy = null;
        }
        await updateDoc(doc(db, "conversations", selectedId), patch);
      } catch (e) {
        console.error(e);
      }
    }
    toast({
      title: newStatus === "resolved" ? "Resolved" : "Reopened",
      description:
        newStatus === "resolved"
          ? "Moved to Agent Logs. View it from the Agent Logs tab."
          : "Conversation reopened to active.",
    });
  };

  // Auto-clear selection when the currently selected conversation is resolved
  // (it's no longer in the visible list, so showing it in the right pane is
  // confusing — the user should see the empty state instead).
  useEffect(() => {
    if (!selected) return;
    if (!showArchived && selected.status === "resolved") {
      setSelectedId(null);
    }
  }, [selected, showArchived]);

  const handleChangeStatus = async (newStatus: "active" | "waiting" | "resolved") => {
    if (!selectedId || !selected) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, status: newStatus } : c))
    );
    if (!usingFallback) {
      try {
        const patch: Record<string, unknown> = { status: newStatus };
        if (newStatus === "resolved") {
          patch.resolvedAt = serverTimestamp();
          patch.resolvedBy =
            profile?.displayName || profile?.email || selected.assignedAgent || null;
        } else if (selected.status === "resolved") {
          patch.resolvedAt = null;
          patch.resolvedBy = null;
        }
        await updateDoc(doc(db, "conversations", selectedId), patch);
      } catch (e) {
        console.error(e);
      }
    }
    toast({ title: "Status updated", description: `Conversation is now ${newStatus}.` });
  };

  const handleChangeChannel = async (newChannel: "sms" | "phone" | "email" | "slack" | "mobile") => {
    if (!selectedId) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, channel: newChannel } : c))
    );
    if (!usingFallback) {
      try {
        await updateDoc(doc(db, "conversations", selectedId), { channel: newChannel });
      } catch (e) {
        console.error(e);
      }
    }
    toast({ title: "Channel updated", description: `Switched to ${newChannel.toUpperCase()}.` });
  };

  const handleDeleteConversation = async () => {
    if (!selectedId) return;
    const idToDelete = selectedId;
    setConfirmDeleteOpen(false);
    if (!usingFallback) {
      try {
        // Soft-delete: mark as archived with deletion timestamp; restorable for 30 days
        await updateDoc(doc(db, "conversations", idToDelete), {
          archived: true,
          deletedAt: serverTimestamp(),
        });
      } catch (e) {
        console.error("Archive failed:", e);
        toast({ title: "Archive failed", variant: "destructive" });
        return;
      }
    } else {
      setConversations((prev) => prev.filter((c) => c.id !== idToDelete));
    }
    setSelectedId(null);
    toast({
      title: "Moved to Archive",
      description: "Restorable for 30 days from the Archive page.",
      action: !usingFallback ? (
        <button
          onClick={async () => {
            try {
              await restoreItem("conversations", idToDelete);
              toast({ title: "Restored", description: "Conversation is back in your active list." });
            } catch (e) {
              toast({ title: "Restore failed", variant: "destructive" });
            }
          }}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-accent transition-colors"
        >
          <RotateCcw className="h-3 w-3" /> Undo
        </button>
      ) : undefined,
    });
  };

  const handleSend = async () => {
    if (!replyText.trim() || !selectedId || usingFallback) return;
    const textToSend = replyText.trim();
    const agentName = profile?.displayName || "Agent";
    try {
      const messageRef = await addDoc(collection(db, "conversations", selectedId, "messages"), {
        conversationId: selectedId,
        sender: "agent",
        text: textToSend,
        timestamp: serverTimestamp(),
        channel: selected?.channel || "email",
        agentName,
      });
      setReplyText("");

      // Outbound Slack: if this conversation originated from a Slack channel,
      // mirror the agent's reply back into Slack via the bot token. Failures
      // are surfaced as a toast but do not block the local message — the
      // ConvoHub thread is still the source of truth.
      if (selected && selected.channel === "slack") {
        try {
          const fn = httpsCallable<
            { conversationId: string; text: string; agentName: string },
            { ok: boolean; ts: string | null; threadTs: string | null }
          >(functions, "replyToSlackChannel");
          const res = await fn({ conversationId: selectedId, text: textToSend, agentName });
          if (res.data.ok) {
            // Persist the Slack ts on the message so we can correlate edits /
            // reactions later, and so support engineers can trace a single
            // ConvoHub message back to its Slack post.
            if (res.data.ts) {
              try {
                await updateDoc(messageRef, {
                  slackTs: res.data.ts,
                  slackThreadTs: res.data.threadTs ?? res.data.ts,
                });
              } catch {
                /* non-fatal — message already saved locally */
              }
            }
            toast({
              title: "Reply sent to Slack",
              description: res.data.threadTs && res.data.threadTs !== res.data.ts
                ? "Threaded under the original Slack message."
                : "Posted back to the originating channel.",
            });
          }
        } catch (err: any) {
          const msg = String(err?.message || err);
          // "failed-precondition" = SLACK_BOT_TOKEN not set or convo missing externalId.
          // Treat as informational so demo conversations don't spam errors.
          const isConfig = msg.includes("SLACK_BOT_TOKEN") || msg.includes("Slack channel id");
          toast({
            title: isConfig ? "Slack not configured" : "Slack post failed",
            description: isConfig
              ? "Set SLACK_BOT_TOKEN on the function to mirror replies back to Slack."
              : msg,
            variant: isConfig ? "default" : "destructive",
          });
        }
      }
    } catch (e) {
      console.error("Failed to send message:", e);
    }
  };

  // Navigate to next/prev conversation
  const navigateConvo = (dir: 1 | -1) => {
    const idx = filtered.findIndex((c) => c.id === selectedId);
    const next = filtered[idx + dir];
    if (next) setSelectedId(next.id);
  };

  const shortcuts = useMemo(() => [
    { key: "r", ctrl: false, shift: false, alt: false, action: () => replyInputRef.current?.focus(), description: "Focus reply box" },
    { key: "j", ctrl: false, shift: false, alt: false, action: () => navigateConvo(1), description: "Next conversation" },
    { key: "k", ctrl: false, shift: false, alt: false, action: () => navigateConvo(-1), description: "Previous conversation" },
    { key: "e", ctrl: false, shift: false, alt: false, action: handleToggleResolved, description: "Toggle resolved" },
    { key: "Escape", ctrl: false, shift: false, alt: false, action: () => { (document.activeElement as HTMLElement)?.blur(); }, description: "Unfocus / close" },
    { key: "?", ctrl: false, shift: true, alt: false, action: () => setShowShortcuts((p) => !p), description: "Show shortcuts" },
  ], [filtered, selectedId])

  useKeyboardShortcuts(shortcuts);

  return (
    <div className="flex h-full">
      {/* Thread List — hidden when a conversation is open on ALL viewports
          (overlay-style; the detail covers the list). */}
      <div
        className={cn(
          "flex w-full flex-shrink-0 flex-col border-r border-border",
          selectedId ? "hidden" : "flex"
        )}
      >
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-foreground">Conversations</h2>
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1">
                    <PackageOpen className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Bulk Export</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleBulkExport("txt")} className="gap-2">
                    <FileText className="h-3.5 w-3.5" /> All as TXT
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkExport("csv")} className="gap-2">
                    <FileSpreadsheet className="h-3.5 w-3.5" /> All as CSV
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <NewConversationDialog />
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search conversations..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="waiting">Waiting</SelectItem>
                {/* Resolved intentionally omitted — see /agent-logs. */}
              </SelectContent>
            </Select>
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue placeholder="Channel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Channels</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="phone">Phone</SelectItem>
                <SelectItem value="slack">Slack</SelectItem>
                <SelectItem value="mobile">Mobile</SelectItem>
              </SelectContent>
            </Select>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 flex-shrink-0" onClick={clearFilters}>
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="flex items-center justify-between mt-3 rounded-md border border-border/60 bg-muted/30 px-3 py-1.5">
            <label htmlFor="show-archived-convos" className="text-xs text-muted-foreground flex items-center gap-1.5 cursor-pointer">
              <ArchiveIcon className="h-3 w-3" />
              Show archived
            </label>
            <Switch
              id="show-archived-convos"
              checked={showArchived}
              onCheckedChange={(v) => {
                setShowArchived(v);
                setSelectedId(null);
              }}
            />
          </div>
        </div>

        {/* Agent/admin banner: shows their open assignment count and a one-click filter. */}
        {showMineBanner && (
          <div className="flex items-center gap-2 border-b border-border bg-primary/5 px-4 py-2">
            <UsersIcon className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            <p className="text-xs text-foreground flex-1 min-w-0">
              You have <span className="font-semibold text-primary">{myOpenCount}</span>{" "}
              open conversation{myOpenCount === 1 ? "" : "s"} assigned
            </p>
            <Button
              variant={mineOnly ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => setMineOnly((v) => !v)}
              aria-pressed={mineOnly}
            >
              {mineOnly ? "Show all" : "Show mine"}
            </Button>
          </div>
        )}

        <PullToRefresh onRefresh={handleRefresh} className="flex-1" disabled={!isMobile}>
          {filtered.map((convo) => (
            <button
              key={convo.id}
              onClick={() => setSelectedId(convo.id)}
              className={`w-full border-b border-border p-4 text-left transition-colors ${selectedId === convo.id ? "bg-accent/30" : "hover:bg-muted/50"}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {convo.customerName.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-medium ${convo.unread ? "text-foreground" : "text-muted-foreground"}`}>{convo.customerName}</span>
                    <span className="text-xs text-muted-foreground">{formatTimestamp(convo.timestamp)}</span>
                  </div>
                  <p className={`mt-0.5 truncate text-xs ${convo.unread ? "text-foreground font-medium" : "text-muted-foreground"}`}>{convo.lastMessage}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px]">
                      {channelIcons[convo.channel]}
                      {convo.channel.toUpperCase()}
                    </Badge>
                    <span className={`inline-flex h-5 items-center rounded-full px-1.5 text-[10px] font-medium ${statusColors[convo.status]}`}>{convo.status}</span>
                    {convo.assignedAgent && (
                      <span className="inline-flex h-5 items-center gap-1 rounded-full bg-primary/5 px-1.5 text-[10px] text-primary">
                        <UserCheck className="h-2.5 w-2.5" />{convo.assignedAgent.split(" ")[0]}
                        {(isSupportByName(supportUsers, convo.assignedAgent) || isSupportByEmail(supportUsers, convo.assignedAgent)) && (
                          <SupportBadge iconOnly className="ml-0.5" />
                        )}
                      </span>
                    )}
                    {(noteCounts[convo.id] ?? 0) > 0 && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(convo.id);
                          // Defer until the thread overlay mounts, then scroll
                          // the notes section into view so the user lands
                          // directly on the shared context instead of the top
                          // of the message list.
                          setTimeout(() => {
                            document
                              .getElementById("conversation-notes-section")
                              ?.scrollIntoView({ behavior: "smooth", block: "center" });
                          }, 320);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedId(convo.id);
                            setTimeout(() => {
                              document
                                .getElementById("conversation-notes-section")
                                ?.scrollIntoView({ behavior: "smooth", block: "center" });
                            }, 320);
                          }
                        }}
                        className="inline-flex h-5 cursor-pointer items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-1.5 text-[10px] font-medium text-warning transition-colors hover:bg-warning/20 focus:outline-none focus:ring-2 focus:ring-warning/40"
                        title={`${noteCounts[convo.id]} shared note${noteCounts[convo.id] === 1 ? "" : "s"} — click to open`}
                        aria-label={`Open conversation and jump to ${noteCounts[convo.id]} notes`}
                      >
                        <StickyNote className="h-2.5 w-2.5" />
                        {noteCounts[convo.id]}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </PullToRefresh>
      </div>

      {/* Thread Detail — animated overlay sliding in from the right */}
      <AnimatePresence mode="wait">
        {selected ? (
          <motion.div
            key={selected.id}
            initial={{ x: "100%", opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0.6 }}
            transition={{ type: "tween", duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            className={cn("flex flex-1 flex-col", !selectedId ? "hidden" : "")}
            onTouchStart={(e) => {
              const t = e.touches[0];
              (e.currentTarget as any)._sx = t.clientX;
              (e.currentTarget as any)._sy = t.clientY;
              (e.currentTarget as any)._st = Date.now();
            }}
            onTouchEnd={(e) => {
              const el = e.currentTarget as any;
              const startX = el._sx as number | undefined;
              const startY = el._sy as number | undefined;
              const startT = el._st as number | undefined;
              if (startX == null || startY == null || startT == null) return;
              const t = e.changedTouches[0];
              const dx = t.clientX - startX;
              const dy = t.clientY - startY;
              const dt = Date.now() - startT;
              // Right-swipe from near the left edge: ≥80px horizontal, mostly horizontal, < 600ms.
              if (startX < 60 && dx > 80 && Math.abs(dy) < 60 && dt < 600) {
                setSelectedId(null);
              }
            }}
          >
            {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 md:px-6 md:py-4">
            <div className="flex min-w-0 items-center gap-2 md:gap-3">
              <Button variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0" onClick={() => setSelectedId(null)} aria-label="Back to conversation list">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{selected.customerName.charAt(0)}</div>
              <div className="min-w-0">
                <h3 className="truncate font-semibold text-foreground">{selected.customerName}</h3>
                <p className="truncate text-xs text-muted-foreground">{selected.customerEmail}</p>
              </div>
            </div>
            <div className="flex flex-shrink-0 flex-nowrap items-center justify-end gap-1.5 sm:gap-2">
              {/* === Always-visible primary actions === */}
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                aria-label="Call customer"
                onClick={() => {
                  if (selected?.customerPhone) {
                    window.open(`tel:${selected.customerPhone}`, "_self");
                  } else {
                    toast({ title: "No phone number", description: "This customer has no phone number on file.", variant: "destructive" });
                  }
                }}
              >
                <Phone className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                aria-label="Email customer"
                onClick={() => {
                  if (selected?.customerEmail) {
                    window.open(`mailto:${selected.customerEmail}`, "_blank");
                  }
                }}
              >
                <Mail className="h-3.5 w-3.5" />
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    aria-label="Share conversation link"
                    onClick={handleCopyLink}
                  >
                    <Share2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Share via system sheet (mobile) or copy link (desktop)</TooltipContent>
              </Tooltip>

              {/* === Secondary actions: visible on md+ === */}
              <div className="hidden md:contents">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 w-8 p-0" aria-label="Export transcript">
                      <FileText className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleCopyTranscript} className="gap-2">
                      <Copy className="h-3.5 w-3.5" /> Copy to Clipboard
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleDownloadTXT} className="gap-2">
                      <Download className="h-3.5 w-3.5" /> Download TXT
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDownloadCSV} className="gap-2">
                      <FileSpreadsheet className="h-3.5 w-3.5" /> Download CSV
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDownloadPDF} className="gap-2">
                      <FileText className="h-3.5 w-3.5" /> Download PDF
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <ConversationTemplates onInsertTemplate={handleInsertTemplate} />
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" aria-label="Open profile" onClick={() => setProfileOpen(true)}>
                  <User className="h-3.5 w-3.5" />
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 w-8 p-0" aria-label="Assign agent">
                      <UserCheck className="h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-2" align="end">
                    <p className="text-xs font-medium text-muted-foreground px-2 py-1 mb-1">
                      Assign to agent
                    </p>
                    {agents.map((agent) => {
                      const load = agentLoad.get(agent) ?? 0;
                      const overloaded = load >= 3;
                      return (
                        <button
                          key={agent}
                          onClick={() => handleAssignAgent(selected.id, agent)}
                          className={cn(
                            "w-full flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded hover:bg-accent transition-colors",
                            selected.assignedAgent === agent && "bg-accent font-medium"
                          )}
                        >
                          <span className="flex-1 truncate">{agent}</span>
                          {load > 0 && (
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                                overloaded
                                  ? "bg-destructive/15 text-destructive"
                                  : "bg-primary/10 text-primary"
                              )}
                              aria-label={`${load} open conversation${load === 1 ? "" : "s"} assigned`}
                              title={`${load} open conversation${load === 1 ? "" : "s"} assigned`}
                            >
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full",
                                  overloaded ? "bg-destructive" : "bg-primary"
                                )}
                              />
                              {load}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {selected.assignedAgent && (
                      <>
                        <div className="my-1 h-px bg-border" />
                        <button
                          onClick={() => handleAssignAgent(selected.id, null)}
                          className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors flex items-center gap-2"
                        >
                          <X className="h-3.5 w-3.5" /> Unassign
                        </button>
                      </>
                    )}
                  </PopoverContent>
                </Popover>
                <CallRecorder
                  conversationId={selected.id}
                  conversationStatus={selected.status}
                  conversationStartedAt={
                    selected.timestamp?.toMillis ? selected.timestamp.toMillis() : undefined
                  }
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" onClick={handleToggleResolved} className="h-8 w-8 p-0" aria-label={selected.status === "resolved" ? "Reopen" : "Resolve"}>
                      {selected.status === "resolved" ? (
                        <RotateCcw className="h-3.5 w-3.5" />
                      ) : (
                        <CheckIcon />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{selected.status === "resolved" ? "Reopen conversation (E)" : "Mark as resolved (E)"}</TooltipContent>
                </Tooltip>
                {selected.archived ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            await restoreItem("conversations", selected.id);
                            toast({ title: "Restored", description: "Conversation moved back to active." });
                          } catch {
                            toast({ title: "Restore failed", variant: "destructive" });
                          }
                        }}
                        className="h-8 w-8 p-0"
                        aria-label="Restore conversation"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Restore from archive</TooltipContent>
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmDeleteOpen(true)}
                        className="h-8 w-8 p-0"
                        aria-label="Archive conversation"
                      >
                        <ArchiveIcon className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Archive conversation</TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" onClick={() => setShowShortcuts((p) => !p)} aria-label="Keyboard shortcuts">
                      <Keyboard className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Keyboard shortcuts (?)</TooltipContent>
                </Tooltip>
              </div>

              {/* === More menu: visible only below md, collapses all secondary actions === */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 px-2 md:hidden" aria-label="More actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => setProfileOpen(true)} className="gap-2">
                    <User className="h-3.5 w-3.5" /> View profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleToggleResolved} className="gap-2">
                    {selected.status === "resolved" ? (
                      <><RotateCcw className="h-3.5 w-3.5" /> Reopen</>
                    ) : (
                      <><span className="inline-block w-3.5 text-center">✓</span> Resolve</>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleCopyTranscript} className="gap-2">
                    <Copy className="h-3.5 w-3.5" /> Copy transcript
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDownloadTXT} className="gap-2">
                    <Download className="h-3.5 w-3.5" /> Download TXT
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDownloadCSV} className="gap-2">
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Download CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDownloadPDF} className="gap-2">
                    <FileText className="h-3.5 w-3.5" /> Download PDF
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {selected.archived ? (
                    <DropdownMenuItem
                      onClick={async () => {
                        try {
                          await restoreItem("conversations", selected.id);
                          toast({ title: "Restored", description: "Conversation moved back to active." });
                        } catch {
                          toast({ title: "Restore failed", variant: "destructive" });
                        }
                      }}
                      className="gap-2"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Restore
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => setConfirmDeleteOpen(true)}
                      className="gap-2"
                    >
                      <ArchiveIcon className="h-3.5 w-3.5" /> Archive
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Keyboard Shortcuts Help */}
          {showShortcuts && (
            <div className="border-b border-border bg-muted/30 px-6 py-3">
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                {shortcuts.map((s) => (
                  <span key={s.key} className="flex items-center gap-1.5">
                    <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">
                      {s.shift ? "⇧+" : ""}{s.ctrl ? "⌘+" : ""}{s.key === " " ? "Space" : s.key.toUpperCase()}
                    </kbd>
                    {s.description}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map((msg) => {
              // Prefer the dedicated `extractText` field on the message doc.
              // Fall back to parsing the legacy "[Imported from <name>]\n\n…"
              // banner so older conversations still render the collapsible
              // section instead of dumping the full extract into the bubble.
              const legacyMatch =
                !msg.extractText && msg.sender === "customer" && typeof msg.text === "string"
                  ? msg.text.match(/^\[Imported from ([^\]]+)\]\s*\n+([\s\S]*)$/)
                  : null;
              const docName = msg.sourceDocName || legacyMatch?.[1] || null;
              const extractBody = msg.extractText || legacyMatch?.[2]?.trim() || null;
              // For legacy messages, strip the banner so the bubble preview
              // is just the agent-typed body (or empty) rather than duplicating
              // the imported text.
              const visibleText = legacyMatch ? "" : msg.text;
              const copyExtract = async () => {
                if (!extractBody) return;
                try {
                  await navigator.clipboard.writeText(extractBody);
                  toast({ title: "Extract copied", description: docName ?? undefined });
                } catch {
                  toast({
                    title: "Could not copy",
                    description: "Clipboard access was blocked.",
                    variant: "destructive",
                  });
                }
              };
              return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${msg.sender === "agent" ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-md rounded-2xl px-4 py-3 ${msg.sender === "agent" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                  {visibleText && (
                    <p className="text-sm whitespace-pre-wrap break-words">{visibleText}</p>
                  )}
                  {extractBody && docName && (
                    <details className={`group ${visibleText ? "mt-2 border-t border-border/40 pt-2" : ""}`}>
                      <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground list-none [&::-webkit-details-marker]:hidden">
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">View original extract · {docName}</span>
                        {msg.sourceDocTruncated && (
                          <span className="text-warning">· truncated</span>
                        )}
                        <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90" />
                      </summary>
                      <div className="mt-2 hidden group-open:block">
                        <div className="flex items-center justify-end mb-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 gap-1 px-2 text-[11px]"
                            onClick={(e) => {
                              e.preventDefault();
                              copyExtract();
                            }}
                          >
                            <Copy className="h-3 w-3" />
                            Copy extract
                          </Button>
                        </div>
                        <ExtractSearch text={extractBody} />
                      </div>
                    </details>
                  )}
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`text-[10px] ${msg.sender === "agent" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{formatMessageTime(msg.timestamp)}</span>
                    <Badge variant="outline" className={`h-4 gap-0.5 px-1 text-[9px] border-0 ${msg.sender === "agent" ? "bg-primary-foreground/20 text-primary-foreground" : ""}`}>
                      {channelIcons[msg.channel]}
                      {msg.channel}
                    </Badge>
                  </div>
                </div>
              </motion.div>
              );
            })}
          </div>

          {/* Conversation notes — shared annotations visible to every teammate.
              Sits above the status bar so notes are part of the thread context
              without being mistaken for messages sent to the customer. */}
          <div id="conversation-notes-section" className="border-t border-border bg-warning/5 px-4 py-3 scroll-mt-20">
            <ConversationNotes conversationId={selected.id} />
          </div>

          {/* Mid-conversation status & channel quick-change */}
          <div className="border-t border-border bg-muted/20 px-4 py-2 flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <Tag className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">Status:</span>
              <Select value={selected.status} onValueChange={(v) => handleChangeStatus(v as any)}>
                <SelectTrigger className="h-7 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="waiting">Waiting</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1.5">
              <Radio className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">Channel:</span>
              <Select value={selected.channel} onValueChange={(v) => handleChangeChannel(v as any)}>
                <SelectTrigger className="h-7 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="phone">Phone</SelectItem>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="mobile">Mobile</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <SlackAlertButton />
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive"
                onClick={() => setElevateOpen(true)}
              >
                <ShieldAlert className="h-3 w-3" />
                <span className="hidden sm:inline">Elevate to webmaster</span>
                <span className="sm:hidden">Elevate</span>
              </Button>
            </div>
          </div>
          <div className="border-t border-border p-4">
            <div className="flex gap-3">
              <Input
                ref={replyInputRef}
                placeholder={usingFallback ? "Connect Firestore to send messages..." : "Type your reply..."}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                className="flex-1"
                disabled={usingFallback}
              />
              <Button disabled={!replyText.trim() || usingFallback} onClick={handleSend}>
                Send <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Elevate to Webmaster — investigation request */}
      <Dialog open={elevateOpen} onOpenChange={setElevateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Elevate to webmaster</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <p className="text-sm text-muted-foreground">
              This will email <strong>kit.tjclasses@gmail.com</strong> asking a webmaster to
              investigate <strong>{selected?.customerName}</strong>'s conversation. The request is
              also logged in <code className="rounded bg-muted px-1 py-0.5 text-xs">investigationRequests</code>.
            </p>
            <div className="space-y-2">
              <Label htmlFor="elevate-reason">Reason (optional)</Label>
              <Textarea
                id="elevate-reason"
                placeholder="What should the webmaster look at?"
                value={elevateReason}
                onChange={(e) => setElevateReason(e.target.value)}
                rows={4}
                maxLength={1000}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setElevateOpen(false)}>Cancel</Button>
              <Button onClick={submitElevation} disabled={elevating} className="gap-2">
                <ShieldAlert className="h-4 w-4" />
                {elevating ? "Sending…" : "Send investigation request"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Profile Modal */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Customer Profile</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 mt-2">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
                  {selected.customerName.charAt(0)}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{selected.customerName}</h3>
                  <p className="text-sm text-muted-foreground">{selected.customerEmail}</p>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Phone</span>
                  <span className="text-sm font-medium text-foreground">{selected.customerPhone || "Not available"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Channel</span>
                  <Badge variant="outline" className="gap-1">{channelIcons[selected.channel]} {selected.channel.toUpperCase()}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <span className={`inline-flex h-6 items-center rounded-full px-2 text-xs font-medium ${statusColors[selected.status]}`}>{selected.status}</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button className="flex-1 gap-2" variant="outline" onClick={() => setEditProfileOpen(true)}>
                  <User className="h-4 w-4" />
                  Edit profile
                </Button>
                <Button className="flex-1 gap-2" variant="default" onClick={handleCallClient} disabled={!selected.customerPhone}>
                  <Phone className="h-4 w-4" />
                  Call {selected.customerName.split(" ")[0]}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm Archive — explicit policy reminder so agents don't hide
          a thread without a real reason. Wording was requested verbatim by
          ops: archiving is reserved for clients who asked us to stand down. */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ArchiveIcon className="h-5 w-5 text-warning" />
              Archive this conversation?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block font-medium text-foreground">
                Archiving conversations should only be done if the client requested disengagement.
              </span>
              <span className="block">
                The thread will be hidden from your active list and moved to the
                Archive page. You can restore it from there within 30 days, after
                which it will be permanently deleted.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConversation}
              className="gap-1.5"
            >
              <ArchiveIcon className="h-4 w-4" />
              Yes, archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Customer (within conversation) */}
      <EditPersonDialog
        open={editProfileOpen}
        onOpenChange={setEditProfileOpen}
        person={
          selected
            ? {
                id: selected.id,
                name: selected.customerName,
                email: selected.customerEmail,
                phone: selected.customerPhone,
              }
            : null
        }
        localOnly
        onLocalSave={async (updated) => {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === updated.id
                ? { ...c, customerName: updated.name, customerEmail: updated.email || "", customerPhone: updated.phone || undefined }
                : c
            )
          );
          if (!usingFallback) {
            try {
              await updateDoc(doc(db, "conversations", updated.id), {
                customerName: updated.name,
                customerEmail: updated.email || "",
                customerPhone: updated.phone || "",
              });
            } catch (e) {
              console.error("Failed to persist profile edit:", e);
              toast({ title: "Saved locally", description: "Could not sync to server.", variant: "destructive" });
            }
          }
        }}
      />

      {/* Recordings list for the selected conversation. */}
      <Dialog open={recordingsListOpen} onOpenChange={setRecordingsListOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mic className="h-4 w-4 text-primary" /> Call recordings
            </DialogTitle>
          </DialogHeader>
          {recordingsLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : recordingsList.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No recordings for this conversation yet.
            </p>
          ) : (
            <ul className="divide-y">
              {recordingsList.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.agentName}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {new Date(r.startedAt).toLocaleString()} • {Math.round((r.durationMs || 0) / 1000)}s
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => {
                      setRecordingsListOpen(false);
                      setPlayerRecording(r);
                    }}
                  >
                    <Mic className="h-3.5 w-3.5" /> Play
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <RecordingPlayerDialog
        recording={playerRecording}
        open={!!playerRecording}
        onOpenChange={(o) => { if (!o) setPlayerRecording(null); }}
      />
    </div>
  );
};

export default Conversations;
