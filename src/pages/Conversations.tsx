import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Plus,
  Phone,
  MessageSquare,
  Mail,
  Clock,
  User,
  ChevronRight,
  Download,
  Copy,
  FileText,
  FileSpreadsheet,
  PackageOpen,
  Filter,
  X,
} from "lucide-react";
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
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import NewConversationDialog from "@/components/NewConversationDialog";
import ConversationTemplates, { type MessageTemplate } from "@/components/ConversationTemplates";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

function buildPDFHTML(convo: Conversation, msgs: ConversationMessage[]): string {
  const msgRows = msgs
    .map(
      (msg) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${formatFullTimestamp(msg.timestamp)}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${msg.sender === "agent" ? "Agent" : convo.customerName}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${msg.text}</td></tr>`
    )
    .join("");
  return `<html><head><style>body{font-family:Arial,sans-serif;padding:32px;color:#1a1a1a}h1{font-size:18px;margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:16px}th{text-align:left;padding:8px;background:#f3f4f6;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #d1d5db}</style></head><body><h1>Conversation Transcript</h1><p style="margin:4px 0;font-size:13px;color:#6b7280">Customer: ${convo.customerName} (${convo.customerEmail})<br/>Channel: ${convo.channel.toUpperCase()} · Status: ${convo.status}<br/>Exported: ${new Date().toLocaleString()}</p><table><thead><tr><th>Time</th><th>Sender</th><th>Message</th></tr></thead><tbody>${msgRows}</tbody></table></body></html>`;
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
  const { profile } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [replyText, setReplyText] = useState("");
  const [usingFallback, setUsingFallback] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");

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
          const convos = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Conversation));
          setConversations(convos);
          setUsingFallback(false);
          if (!selectedId || !convos.find((c) => c.id === selectedId)) {
            setSelectedId(convos[0]?.id || null);
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
        setMessages(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as ConversationMessage)));
      },
      (error) => {
        console.error("Messages listener error:", error);
        setMessages([]);
      }
    );
    return unsub;
  }, [selectedId, usingFallback]);

  const filtered = conversations.filter((c) => {
    const matchesSearch =
      c.customerName.toLowerCase().includes(search.toLowerCase()) ||
      c.lastMessage.toLowerCase().includes(search.toLowerCase());
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

  return (
    <div className="flex h-full">
      {/* Thread List */}
      <div className="w-80 flex-shrink-0 border-r border-border flex flex-col">
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-foreground">Conversations</h2>
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1">
                    <PackageOpen className="h-3.5 w-3.5" />
                    Bulk Export
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
        </div>

        <div className="flex-1 overflow-y-auto">
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
                  <div className="mt-1.5 flex items-center gap-2">
                    <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px]">
                      {channelIcons[convo.channel]}
                      {convo.channel.toUpperCase()}
                    </Badge>
                    <span className={`inline-flex h-5 items-center rounded-full px-1.5 text-[10px] font-medium ${statusColors[convo.status]}`}>{convo.status}</span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Thread Detail */}
      {selected ? (
        <div className="flex flex-1 flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{selected.customerName.charAt(0)}</div>
              <div>
                <h3 className="font-semibold text-foreground">{selected.customerName}</h3>
                <p className="text-xs text-muted-foreground">{selected.customerEmail}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <FileText className="h-3.5 w-3.5" /> Export
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
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setProfileOpen(true)}>
                <User className="h-3.5 w-3.5" /> Profile
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Clock className="h-3.5 w-3.5" /> History
              </Button>
            </div>
          </div>

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

          {/* Reply */}
          <div className="border-t border-border p-4">
            <div className="flex gap-3">
              <Input
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
        <div className="flex flex-1 items-center justify-center text-muted-foreground">Select a conversation to view</div>
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

              <Button className="w-full gap-2" variant="default" onClick={handleCallClient} disabled={!selected.customerPhone}>
                <Phone className="h-4 w-4" />
                Call {selected.customerName.split(" ")[0]}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Conversations;
