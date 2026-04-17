import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
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
import { Switch } from "@/components/ui/switch";
import NewConversationDialog from "@/components/NewConversationDialog";
import ConversationTemplates, { type MessageTemplate } from "@/components/ConversationTemplates";
import EditPersonDialog, { type EditablePerson } from "@/components/EditPersonDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

interface Conversation {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  lastMessage: string;
  channel: "sms" | "phone" | "email" | "slack";
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
  channel: "sms" | "phone" | "email" | "slack";
}

const channelIcons = {
  sms: <MessageSquare className="h-3.5 w-3.5" />,
  phone: <Phone className="h-3.5 w-3.5" />,
  email: <Mail className="h-3.5 w-3.5" />,
  slack: <MessageSquare className="h-3.5 w-3.5" />,
};

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
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [showShortcuts, setShowShortcuts] = useState(false);
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

  const agents = ["Alice Johnson", "Bob Smith", "Carol Davis", "Dan Lee"];

  const handleRefresh = async () => {
    await new Promise((r) => setTimeout(r, 600));
    toast({ title: "Refreshed", description: "Conversations are up to date." });
  };


  // Single conversation export handlers
  const selected = conversations.find((c) => c.id === selectedId);

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

  // Real-time conversations listener
  useEffect(() => {
    const q = query(collection(db, "conversations"), orderBy("timestamp", "desc"));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        if (snapshot.empty) {
          setConversations(fallbackConversations);
          setUsingFallback(true);
          setSelectedId("mock-1");
        } else {
          const convos = snapshot.docs.map(
            (d) => ({ id: d.id, ...d.data() } as Conversation)
          );
          setConversations(convos);
          setUsingFallback(false);
          const visible = convos.filter((c) => (showArchived ? c.archived : !c.archived));
          if (!selectedId || !visible.find((c) => c.id === selectedId)) {
            setSelectedId(visible[0]?.id || null);
          }
        }
      },
      (error) => {
        console.error("Conversations listener error:", error);
        setConversations(fallbackConversations);
        setUsingFallback(true);
        setSelectedId("mock-1");
      }
    );
    return unsub;
  }, []);

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

  const filtered = conversations.filter((c) => {
    const archivedMatch = showArchived ? !!c.archived : !c.archived;
    if (!archivedMatch) return false;
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
        await updateDoc(doc(db, "conversations", selectedId), { status: newStatus });
      } catch (e) {
        console.error(e);
      }
    }
    toast({
      title: newStatus === "resolved" ? "Resolved" : "Reopened",
      description: newStatus === "resolved" ? "Conversation marked as resolved." : "Conversation reopened to active.",
    });
  };

  const handleChangeStatus = async (newStatus: "active" | "waiting" | "resolved") => {
    if (!selectedId) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, status: newStatus } : c))
    );
    if (!usingFallback) {
      try {
        await updateDoc(doc(db, "conversations", selectedId), { status: newStatus });
      } catch (e) {
        console.error(e);
      }
    }
    toast({ title: "Status updated", description: `Conversation is now ${newStatus}.` });
  };

  const handleChangeChannel = async (newChannel: "sms" | "phone" | "email" | "slack") => {
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
    try {
      await addDoc(collection(db, "conversations", selectedId, "messages"), {
        conversationId: selectedId,
        sender: "agent",
        text: replyText.trim(),
        timestamp: serverTimestamp(),
        channel: selected?.channel || "email",
        agentName: profile?.displayName || "Agent",
      });
      setReplyText("");
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
      {/* Thread List — full width on mobile when nothing selected, hidden on mobile when selected */}
      <div
        className={cn(
          "flex w-full flex-shrink-0 flex-col border-r border-border md:w-80",
          isMobile && selectedId ? "hidden" : "flex"
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
                <SelectItem value="resolved">Resolved</SelectItem>
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
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </PullToRefresh>
      </div>

      {/* Thread Detail */}
      {selected ? (
        <div className={cn("flex flex-1 flex-col", isMobile && !selectedId ? "hidden" : "")}>
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 md:px-6 md:py-4">
            <div className="flex min-w-0 items-center gap-2 md:gap-3">
              {isMobile && (
                <Button variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0" onClick={() => setSelectedId(null)} aria-label="Back">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{selected.customerName.charAt(0)}</div>
              <div className="min-w-0">
                <h3 className="truncate font-semibold text-foreground">{selected.customerName}</h3>
                <p className="truncate text-xs text-muted-foreground">{selected.customerEmail}</p>
              </div>
            </div>
            <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 px-2 sm:px-3" aria-label="Export transcript">
                    <FileText className="h-3.5 w-3.5" /> <span className="hidden lg:inline">Export</span>
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
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 px-2 sm:px-3"
                aria-label="Call customer"
                onClick={() => {
                  if (selected?.customerPhone) {
                    window.open(`tel:${selected.customerPhone}`, "_self");
                  } else {
                    toast({ title: "No phone number", description: "This customer has no phone number on file.", variant: "destructive" });
                  }
                }}
              >
                <Phone className="h-3.5 w-3.5" /> <span className="hidden lg:inline">Call</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 px-2 sm:px-3"
                aria-label="Email customer"
                onClick={() => {
                  if (selected?.customerEmail) {
                    window.open(`mailto:${selected.customerEmail}`, "_blank");
                  }
                }}
              >
                <Mail className="h-3.5 w-3.5" /> <span className="hidden lg:inline">Email</span>
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 px-2 sm:px-3" aria-label="Open profile" onClick={() => setProfileOpen(true)}>
                <User className="h-3.5 w-3.5" /> <span className="hidden lg:inline">Profile</span>
              </Button>
              {/* Assign Agent */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 px-2 sm:px-3" aria-label="Assign agent">
                    <UserCheck className="h-3.5 w-3.5" />
                    <span className="hidden lg:inline">{selected.assignedAgent ? selected.assignedAgent.split(" ")[0] : "Assign"}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-2" align="end">
                  <p className="text-xs font-medium text-muted-foreground px-2 py-1 mb-1">Assign to agent</p>
                  {agents.map((agent) => (
                    <button
                      key={agent}
                      onClick={() => handleAssignAgent(selected.id, agent)}
                      className={`w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent transition-colors ${selected.assignedAgent === agent ? "bg-accent font-medium" : ""}`}
                    >
                      {agent}
                    </button>
                  ))}
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
              {/* Toggle Resolved / Reopen */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" onClick={handleToggleResolved} className="gap-1.5 px-2 sm:px-3" aria-label={selected.status === "resolved" ? "Reopen" : "Resolve"}>
                    {selected.status === "resolved" ? (
                      <><RotateCcw className="h-3.5 w-3.5" /> <span className="hidden lg:inline">Reopen</span></>
                    ) : (
                      <>✓ <span className="hidden lg:inline">Resolve</span></>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{selected.status === "resolved" ? "Reopen conversation (E)" : "Mark as resolved (E)"}</TooltipContent>
              </Tooltip>
              {/* Delete or Restore */}
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
                      className="gap-1.5 px-2 sm:px-3"
                      aria-label="Restore conversation"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> <span className="hidden lg:inline">Restore</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Restore from archive</TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" onClick={() => setConfirmDeleteOpen(true)} className="px-2 sm:px-3 text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label="Delete conversation">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete conversation</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" onClick={() => setShowShortcuts((p) => !p)} className="hidden md:inline-flex" aria-label="Keyboard shortcuts">
                    <Keyboard className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Keyboard shortcuts (?)</TooltipContent>
              </Tooltip>
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
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${msg.sender === "agent" ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-md rounded-2xl px-4 py-3 ${msg.sender === "agent" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                  <p className="text-sm">{msg.text}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`text-[10px] ${msg.sender === "agent" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{formatMessageTime(msg.timestamp)}</span>
                    <Badge variant="outline" className={`h-4 gap-0.5 px-1 text-[9px] border-0 ${msg.sender === "agent" ? "bg-primary-foreground/20 text-primary-foreground" : ""}`}>
                      {channelIcons[msg.channel]}
                      {msg.channel}
                    </Badge>
                  </div>
                </div>
              </motion.div>
            ))}
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
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Reply */}
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
        </div>
      ) : (
        <div className="hidden flex-1 items-center justify-center text-muted-foreground md:flex">Select a conversation to view</div>
      )}

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

      {/* Confirm Delete */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move to Archive?</AlertDialogTitle>
            <AlertDialogDescription>
              The thread will be hidden from your active list. You can restore it from the Archive page within 30 days, after which it will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConversation} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Archive
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
    </div>
  );
};

export default Conversations;
