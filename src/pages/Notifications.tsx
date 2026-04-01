import React from "react";
import { motion } from "framer-motion";
import { Bell, Check, AlertCircle, MessageSquare, Phone, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const mockNotifications = [
  { id: "1", type: "message" as const, title: "New message from Sarah Mitchell", description: "Replied via email about billing", time: "2 min ago", read: false },
  { id: "2", type: "call" as const, title: "Missed call from James Rodriguez", description: "+1 555-0102 — 2m 34s", time: "15 min ago", read: false },
  { id: "3", type: "alert" as const, title: "SLA warning: Emily Chen", description: "Response time approaching 4-hour limit", time: "1 hr ago", read: true },
  { id: "4", type: "message" as const, title: "Slack notification sent", description: "Auto-notification to #support channel", time: "2 hrs ago", read: true },
  { id: "5", type: "message" as const, title: "Gmail notification sent", description: "Follow-up sent to michael@example.com", time: "3 hrs ago", read: true },
];

const typeIcons = {
  message: <MessageSquare className="h-4 w-4" />,
  call: <Phone className="h-4 w-4" />,
  alert: <AlertCircle className="h-4 w-4" />,
};

const Notifications: React.FC = () => (
  <div className="p-8 max-w-3xl mx-auto">
    <div className="flex items-center justify-between mb-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
        <p className="text-muted-foreground mt-1">Stay on top of every interaction</p>
      </div>
      <Button variant="outline" size="sm" className="gap-2">
        <Check className="h-4 w-4" />
        Mark all read
      </Button>
    </div>

    <div className="space-y-2">
      {mockNotifications.map((n, i) => (
        <motion.div
          key={n.id}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.05 }}
          className={`flex items-start gap-4 rounded-xl border p-4 transition-colors ${
            n.read ? "border-border bg-card" : "border-primary/30 bg-primary/5"
          }`}
        >
          <div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg ${n.read ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
            {typeIcons[n.type]}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm ${n.read ? "text-foreground" : "font-medium text-foreground"}`}>{n.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{n.description}</p>
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{n.time}</span>
          {!n.read && <div className="mt-1.5 h-2 w-2 rounded-full bg-primary flex-shrink-0" />}
        </motion.div>
      ))}
    </div>
  </div>
);

export default Notifications;
