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
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import NewConversationDialog from "@/components/NewConversationDialog";

interface Conversation {
  id: string;
  customerName: string;
  customerEmail: string;
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

// Fallback mock data when Firestore collections are empty
const fallbackConversations: Conversation[] = [
  {
    id: "mock-1",
    customerName: "Sarah Mitchell",
    customerEmail: "sarah@example.com",
    lastMessage: "Thanks for helping me with the billing issue!",
    channel: "email",
    timestamp: null,
    unread: true,
    status: "active",
  },
  {
    id: "mock-2",
    customerName: "James Rodriguez",
    customerEmail: "james@example.com",
    lastMessage: "Can I get an update on my order?",
    channel: "sms",
    timestamp: null,
    unread: true,
    status: "waiting",
  },
  {
    id: "mock-3",
    customerName: "Emily Chen",
    customerEmail: "emily@example.com",
    lastMessage: "The issue has been resolved, thank you!",
    channel: "phone",
    timestamp: null,
    unread: false,
    status: "resolved",
  },
  {
    id: "mock-4",
    customerName: "Michael Brown",
    customerEmail: "michael@example.com",
    lastMessage: "I need help with my subscription cancellation.",
    channel: "slack",
    timestamp: null,
    unread: false,
    status: "active",
  },
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

const Conversations: React.FC = () => {
  const { profile } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [replyText, setReplyText] = useState("");
  const [usingFallback, setUsingFallback] = useState(false);

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
    const q = query(
      collection(db, "conversations", selectedId, "messages"),
      orderBy("timestamp", "asc")
    );
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

  const selected = conversations.find((c) => c.id === selectedId);

  const filtered = conversations.filter(
    (c) =>
      c.customerName.toLowerCase().includes(search.toLowerCase()) ||
      c.lastMessage.toLowerCase().includes(search.toLowerCase())
  );

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
            <NewConversationDialog />
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.map((convo) => (
            <button
              key={convo.id}
              onClick={() => setSelectedId(convo.id)}
              className={`w-full border-b border-border p-4 text-left transition-colors ${
                selectedId === convo.id ? "bg-accent/30" : "hover:bg-muted/50"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {convo.customerName.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-medium ${convo.unread ? "text-foreground" : "text-muted-foreground"}`}>
                      {convo.customerName}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatTimestamp(convo.timestamp)}</span>
                  </div>
                  <p className={`mt-0.5 truncate text-xs ${convo.unread ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                    {convo.lastMessage}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px]">
                      {channelIcons[convo.channel]}
                      {convo.channel.toUpperCase()}
                    </Badge>
                    <span className={`inline-flex h-5 items-center rounded-full px-1.5 text-[10px] font-medium ${statusColors[convo.status]}`}>
                      {convo.status}
                    </span>
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
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {selected.customerName.charAt(0)}
              </div>
              <div>
                <h3 className="font-semibold text-foreground">{selected.customerName}</h3>
                <p className="text-xs text-muted-foreground">{selected.customerEmail}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5">
                <User className="h-3.5 w-3.5" />
                Profile
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                History
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
                <div
                  className={`max-w-md rounded-2xl px-4 py-3 ${
                    msg.sender === "agent"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  <p className="text-sm">{msg.text}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`text-[10px] ${msg.sender === "agent" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {formatMessageTime(msg.timestamp)}
                    </span>
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
                Send
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          Select a conversation to view
        </div>
      )}
    </div>
  );
};

export default Conversations;
