import React, { useState } from "react";
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

interface Conversation {
  id: string;
  customerName: string;
  customerEmail: string;
  lastMessage: string;
  channel: "sms" | "phone" | "email" | "slack";
  timestamp: string;
  unread: boolean;
  status: "active" | "waiting" | "resolved";
}

const mockConversations: Conversation[] = [
  {
    id: "1",
    customerName: "Sarah Mitchell",
    customerEmail: "sarah@example.com",
    lastMessage: "Thanks for helping me with the billing issue!",
    channel: "email",
    timestamp: "2 min ago",
    unread: true,
    status: "active",
  },
  {
    id: "2",
    customerName: "James Rodriguez",
    customerEmail: "james@example.com",
    lastMessage: "Can I get an update on my order?",
    channel: "sms",
    timestamp: "15 min ago",
    unread: true,
    status: "waiting",
  },
  {
    id: "3",
    customerName: "Emily Chen",
    customerEmail: "emily@example.com",
    lastMessage: "The issue has been resolved, thank you!",
    channel: "phone",
    timestamp: "1 hr ago",
    unread: false,
    status: "resolved",
  },
  {
    id: "4",
    customerName: "Michael Brown",
    customerEmail: "michael@example.com",
    lastMessage: "I need help with my subscription cancellation.",
    channel: "slack",
    timestamp: "3 hrs ago",
    unread: false,
    status: "active",
  },
];

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

interface ConversationMessage {
  id: string;
  sender: "customer" | "agent";
  text: string;
  timestamp: string;
  channel: "sms" | "phone" | "email" | "slack";
}

const mockMessages: ConversationMessage[] = [
  { id: "m1", sender: "customer", text: "Hi, I have a question about my recent bill.", timestamp: "10:30 AM", channel: "email" },
  { id: "m2", sender: "agent", text: "Of course! I'd be happy to help. Could you share your account number?", timestamp: "10:32 AM", channel: "email" },
  { id: "m3", sender: "customer", text: "Sure, it's ACC-29481.", timestamp: "10:33 AM", channel: "email" },
  { id: "m4", sender: "agent", text: "Thank you Sarah. I can see a $24.99 charge from March 15. This was for the premium plan upgrade.", timestamp: "10:35 AM", channel: "email" },
  { id: "m5", sender: "customer", text: "Oh I see! Thanks for helping me with the billing issue!", timestamp: "10:36 AM", channel: "email" },
];

const Conversations: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string>("1");
  const [search, setSearch] = useState("");
  const [replyText, setReplyText] = useState("");

  const selected = mockConversations.find((c) => c.id === selectedId);

  const filtered = mockConversations.filter(
    (c) =>
      c.customerName.toLowerCase().includes(search.toLowerCase()) ||
      c.lastMessage.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-full">
      {/* Thread List */}
      <div className="w-80 flex-shrink-0 border-r border-border flex flex-col">
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-foreground">Conversations</h2>
            <Button size="sm" className="h-8 w-8 p-0">
              <Plus className="h-4 w-4" />
            </Button>
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
                    <span className="text-xs text-muted-foreground">{convo.timestamp}</span>
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
            {mockMessages.map((msg) => (
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
                      {msg.timestamp}
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
                placeholder="Type your reply..."
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                className="flex-1"
              />
              <Button disabled={!replyText.trim()}>
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
