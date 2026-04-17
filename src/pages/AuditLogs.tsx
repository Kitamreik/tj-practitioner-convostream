import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Shield, LogIn, Bell, UserPlus, Pencil, Trash2, Plus, Check, AlertCircle, MessageSquare, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface LoginAttempt {
  id: string;
  email: string;
  success: boolean;
  timestamp: any;
  userAgent: string;
}

type NoteAction = "create" | "edit" | "delete" | "mark_read";
type NoteType = "message" | "call" | "alert";

interface NoteAuditRow {
  id: string;
  action: NoteAction;
  type: NoteType;
  title: string;
  description?: string;
  actor: string;
  timestamp: any;
}

interface PeopleAuditRow {
  id: string;
  personId: string;
  name: string;
  email?: string;
  phone?: string;
  actor: string;
  timestamp: any;
}

const noteActionMeta: Record<NoteAction, { label: string; icon: React.ReactNode; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  create: { label: "Created", icon: <Plus className="h-3 w-3" />, variant: "default" },
  edit: { label: "Edited", icon: <Pencil className="h-3 w-3" />, variant: "secondary" },
  delete: { label: "Deleted", icon: <Trash2 className="h-3 w-3" />, variant: "destructive" },
  mark_read: { label: "Marked read", icon: <Check className="h-3 w-3" />, variant: "outline" },
};

const noteTypeIcon: Record<NoteType, React.ReactNode> = {
  message: <MessageSquare className="h-3.5 w-3.5" />,
  call: <Phone className="h-3.5 w-3.5" />,
  alert: <AlertCircle className="h-3.5 w-3.5" />,
};

function formatTs(ts: any): string {
  return ts?.toDate?.() ? ts.toDate().toLocaleString() : "—";
}

const AuditLogs: React.FC = () => {
  const [loginAttempts, setLoginAttempts] = useState<LoginAttempt[]>([]);
  const [loadingLogins, setLoadingLogins] = useState(true);

  const [notes, setNotes] = useState<NoteAuditRow[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);

  const [people, setPeople] = useState<PeopleAuditRow[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "login_attempts"), orderBy("timestamp", "desc"), limit(50));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        setLoginAttempts(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as LoginAttempt)));
        setLoadingLogins(false);
      },
      (error) => {
        console.error("Failed to listen to login attempts:", error);
        setLoadingLogins(false);
      }
    );
    return unsub;
  }, []);

  useEffect(() => {
    const q = query(collection(db, "noteAudit"), orderBy("timestamp", "desc"), limit(100));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        setNotes(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as NoteAuditRow)));
        setLoadingNotes(false);
      },
      (error) => {
        console.error("Failed to listen to noteAudit:", error);
        setLoadingNotes(false);
      }
    );
    return unsub;
  }, []);

  useEffect(() => {
    const q = query(collection(db, "peopleAudit"), orderBy("timestamp", "desc"), limit(100));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        setPeople(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as PeopleAuditRow)));
        setLoadingPeople(false);
      },
      (error) => {
        console.error("Failed to listen to peopleAudit:", error);
        setLoadingPeople(false);
      }
    );
    return unsub;
  }, []);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 md:mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Shield className="h-7 w-7 text-primary" />
            Audit Logs
          </h1>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">
            Real-time security and activity events. Notification edits and new people are tracked as they happen.
          </p>
        </div>
      </div>

      <Tabs defaultValue="logins" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="logins" className="gap-2">
            <LogIn className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Login Attempts</span>
            <span className="sm:hidden">Logins</span>
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-2">
            <Bell className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Notification Changes</span>
            <span className="sm:hidden">Notes</span>
          </TabsTrigger>
          <TabsTrigger value="people" className="gap-2">
            <UserPlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New People</span>
            <span className="sm:hidden">People</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="logins">
          <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Email</th>
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Timestamp</th>
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">User Agent</th>
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
                      transition={{ delay: i * 0.02 }}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 md:px-6 py-3 text-sm text-foreground">{attempt.email}</td>
                      <td className="px-4 md:px-6 py-3">
                        <Badge variant={attempt.success ? "default" : "destructive"} className="text-xs">
                          {attempt.success ? "Success" : "Failed"}
                        </Badge>
                      </td>
                      <td className="px-4 md:px-6 py-3 text-sm text-muted-foreground">{formatTs(attempt.timestamp)}</td>
                      <td className="px-4 md:px-6 py-3 text-xs text-muted-foreground max-w-xs truncate">{attempt.userAgent || "—"}</td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="notes">
          <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Action</th>
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Type</th>
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Title</th>
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Actor</th>
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">When</th>
                </tr>
              </thead>
              <tbody>
                {loadingNotes ? (
                  <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : notes.length === 0 ? (
                  <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                    No notification activity yet. Add or edit a note on the Notifications page to see entries here.
                  </td></tr>
                ) : (
                  notes.map((n, i) => {
                    const meta = noteActionMeta[n.action] || noteActionMeta.create;
                    return (
                      <motion.tr
                        key={n.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.02 }}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 md:px-6 py-3">
                          <Badge variant={meta.variant} className="gap-1 text-xs">
                            {meta.icon}
                            {meta.label}
                          </Badge>
                        </td>
                        <td className="px-4 md:px-6 py-3">
                          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            {noteTypeIcon[n.type] || <Bell className="h-3.5 w-3.5" />}
                            <span className="capitalize">{n.type}</span>
                          </span>
                        </td>
                        <td className="px-4 md:px-6 py-3">
                          <p className="text-sm text-foreground">{n.title}</p>
                          {n.description && <p className="text-xs text-muted-foreground line-clamp-1">{n.description}</p>}
                        </td>
                        <td className="px-4 md:px-6 py-3 text-sm text-muted-foreground">{n.actor}</td>
                        <td className="px-4 md:px-6 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatTs(n.timestamp)}</td>
                      </motion.tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="people">
          <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Person</th>
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Email</th>
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Phone</th>
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Added by</th>
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">When</th>
                </tr>
              </thead>
              <tbody>
                {loadingPeople ? (
                  <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : people.length === 0 ? (
                  <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                    No new people yet. Add a person on the People page and they'll show up here.
                  </td></tr>
                ) : (
                  people.map((p, i) => (
                    <motion.tr
                      key={p.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.02 }}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 md:px-6 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {(p.name || "?").charAt(0)}
                          </div>
                          <span className="text-sm font-medium text-foreground">{p.name || "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 md:px-6 py-3 text-sm text-muted-foreground">{p.email || "—"}</td>
                      <td className="px-4 md:px-6 py-3 text-sm text-muted-foreground">{p.phone || "—"}</td>
                      <td className="px-4 md:px-6 py-3 text-sm text-muted-foreground">{p.actor}</td>
                      <td className="px-4 md:px-6 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatTs(p.timestamp)}</td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AuditLogs;
