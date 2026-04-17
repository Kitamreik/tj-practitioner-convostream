import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Check, AlertCircle, MessageSquare, Phone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import PullToRefresh from "@/components/PullToRefresh";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";

interface Notification {
  id: string;
  type: "message" | "call" | "alert";
  title: string;
  description: string;
  time: string;
  read: boolean;
}

const initialNotifications: Notification[] = [
  { id: "1", type: "message", title: "New message from Sarah Mitchell", description: "Replied via email about billing", time: "2 min ago", read: false },
  { id: "2", type: "call", title: "Missed call from James Rodriguez", description: "+1 555-0102 — 2m 34s", time: "15 min ago", read: false },
  { id: "3", type: "alert", title: "SLA warning: Emily Chen", description: "Response time approaching 4-hour limit", time: "1 hr ago", read: true },
  { id: "4", type: "message", title: "Slack notification sent", description: "Auto-notification to #support channel", time: "2 hrs ago", read: true },
  { id: "5", type: "message", title: "Gmail notification sent", description: "Follow-up sent to michael@example.com", time: "3 hrs ago", read: true },
];

const typeIcons = {
  message: <MessageSquare className="h-4 w-4" />,
  call: <Phone className="h-4 w-4" />,
  alert: <AlertCircle className="h-4 w-4" />,
};

const Notifications: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const deleteNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
          <p className="text-muted-foreground mt-1">Stay on top of every interaction</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={markAllRead}>
          <Check className="h-4 w-4" />
          Mark all read
        </Button>
      </div>

      <div className="space-y-2">
        <AnimatePresence>
          {notifications.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">No notifications</div>
          )}
          {notifications.map((n, i) => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10, height: 0, marginBottom: 0, padding: 0, overflow: "hidden" }}
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
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive flex-shrink-0"
                onClick={() => deleteNotification(n.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Notifications;
