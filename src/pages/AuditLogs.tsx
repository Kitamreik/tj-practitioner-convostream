import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Shield, LogIn, Phone, MessageSquare, Bell, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface LoginAttempt {
  id: string;
  email: string;
  success: boolean;
  timestamp: any;
  userAgent: string;
}

interface CallLog {
  id: string;
  customerName: string;
  phoneNumber: string;
  duration: string;
  direction: "inbound" | "outbound";
  timestamp: string;
}

interface TextSummary {
  id: string;
  customerName: string;
  phoneNumber: string;
  messageCount: number;
  lastMessage: string;
  timestamp: string;
}

interface NotificationLog {
  id: string;
  channel: "slack" | "gmail";
  recipient: string;
  subject: string;
  status: "sent" | "failed";
  timestamp: string;
}

const mockCallLogs: CallLog[] = [
  { id: "c1", customerName: "Sarah Mitchell", phoneNumber: "+1 555-0101", duration: "4m 22s", direction: "inbound", timestamp: "2025-04-01 10:30 AM" },
  { id: "c2", customerName: "James Rodriguez", phoneNumber: "+1 555-0102", duration: "2m 34s", direction: "outbound", timestamp: "2025-04-01 09:15 AM" },
  { id: "c3", customerName: "Emily Chen", phoneNumber: "+1 555-0103", duration: "8m 11s", direction: "inbound", timestamp: "2025-03-31 04:45 PM" },
];

const mockTextSummaries: TextSummary[] = [
  { id: "t1", customerName: "Sarah Mitchell", phoneNumber: "+1 555-0101", messageCount: 8, lastMessage: "Thanks for the update!", timestamp: "2025-04-01 10:36 AM" },
  { id: "t2", customerName: "Michael Brown", phoneNumber: "+1 555-0104", messageCount: 3, lastMessage: "When will my order ship?", timestamp: "2025-04-01 08:20 AM" },
];

const mockNotifLogs: NotificationLog[] = [
  { id: "n1", channel: "slack", recipient: "#support", subject: "New conversation: Sarah Mitchell", status: "sent", timestamp: "2025-04-01 10:31 AM" },
  { id: "n2", channel: "gmail", recipient: "team@company.com", subject: "SLA Alert: Emily Chen", status: "sent", timestamp: "2025-04-01 09:00 AM" },
  { id: "n3", channel: "slack", recipient: "#escalations", subject: "Escalation: James Rodriguez", status: "failed", timestamp: "2025-03-31 05:00 PM" },
];

const AuditLogs: React.FC = () => {
  const [loginAttempts, setLoginAttempts] = useState<LoginAttempt[]>([]);
  const [loadingLogins, setLoadingLogins] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "login_attempts"), orderBy("timestamp", "desc"), limit(50));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        setLoginAttempts(
          snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as LoginAttempt))
        );
        setLoadingLogins(false);
      },
      (error) => {
        console.error("Failed to listen to login attempts:", error);
        setLoadingLogins(false);
      }
    );
    return unsub;
  }, []);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Shield className="h-7 w-7 text-primary" />
            Audit Logs
          </h1>
          <p className="text-muted-foreground mt-1">Monitor system activity and security events — login attempts update in real-time</p>
        </div>
      </div>

      <Tabs defaultValue="logins" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="logins" className="gap-2">
            <LogIn className="h-3.5 w-3.5" />
            Login Attempts
          </TabsTrigger>
          <TabsTrigger value="calls" className="gap-2">
            <Phone className="h-3.5 w-3.5" />
            Call Logs
          </TabsTrigger>
          <TabsTrigger value="texts" className="gap-2">
            <MessageSquare className="h-3.5 w-3.5" />
            Text Summaries
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="h-3.5 w-3.5" />
            Notifications
          </TabsTrigger>
        </TabsList>

        <TabsContent value="logins">
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Timestamp</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">User Agent</th>
                </tr>
              </thead>
              <tbody>
                {loadingLogins ? (
                  <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : loginAttempts.length === 0 ? (
                  <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">No login attempts recorded yet</td></tr>
                ) : (
                  loginAttempts.map((attempt, i) => (
                    <motion.tr
                      key={attempt.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.03 }}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-6 py-3 text-sm text-foreground">{attempt.email}</td>
                      <td className="px-6 py-3">
                        <Badge variant={attempt.success ? "default" : "destructive"} className="text-xs">
                          {attempt.success ? "Success" : "Failed"}
                        </Badge>
                      </td>
                      <td className="px-6 py-3 text-sm text-muted-foreground">
                        {attempt.timestamp?.toDate?.()
                          ? attempt.timestamp.toDate().toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-6 py-3 text-xs text-muted-foreground max-w-xs truncate">{attempt.userAgent || "—"}</td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="calls">
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Customer</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Phone</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Direction</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Duration</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {mockCallLogs.map((log, i) => (
                  <motion.tr key={log.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="border-b border-border last:border-0">
                    <td className="px-6 py-3 text-sm font-medium text-foreground">{log.customerName}</td>
                    <td className="px-6 py-3 text-sm text-muted-foreground">{log.phoneNumber}</td>
                    <td className="px-6 py-3">
                      <Badge variant="outline" className="text-xs capitalize">{log.direction}</Badge>
                    </td>
                    <td className="px-6 py-3 text-sm text-foreground">{log.duration}</td>
                    <td className="px-6 py-3 text-sm text-muted-foreground">{log.timestamp}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="texts">
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Customer</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Phone</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Messages</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Last Message</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {mockTextSummaries.map((ts, i) => (
                  <motion.tr key={ts.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="border-b border-border last:border-0">
                    <td className="px-6 py-3 text-sm font-medium text-foreground">{ts.customerName}</td>
                    <td className="px-6 py-3 text-sm text-muted-foreground">{ts.phoneNumber}</td>
                    <td className="px-6 py-3 text-sm text-foreground">{ts.messageCount}</td>
                    <td className="px-6 py-3 text-sm text-muted-foreground max-w-xs truncate">{ts.lastMessage}</td>
                    <td className="px-6 py-3 text-sm text-muted-foreground">{ts.timestamp}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="notifications">
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Channel</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Recipient</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Subject</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {mockNotifLogs.map((nl, i) => (
                  <motion.tr key={nl.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="border-b border-border last:border-0">
                    <td className="px-6 py-3">
                      <Badge variant="outline" className="text-xs capitalize">{nl.channel}</Badge>
                    </td>
                    <td className="px-6 py-3 text-sm text-foreground">{nl.recipient}</td>
                    <td className="px-6 py-3 text-sm text-muted-foreground">{nl.subject}</td>
                    <td className="px-6 py-3">
                      <Badge variant={nl.status === "sent" ? "default" : "destructive"} className="text-xs">{nl.status}</Badge>
                    </td>
                    <td className="px-6 py-3 text-sm text-muted-foreground">{nl.timestamp}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AuditLogs;
