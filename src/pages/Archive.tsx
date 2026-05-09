import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import {
  Archive as ArchiveIcon,
  RotateCcw,
  Trash2,
  MessageCircle,
  Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { daysRemaining, isExpired, ARCHIVE_RETENTION_DAYS } from "@/lib/softDelete";
import { useAuth } from "@/contexts/AuthContext";
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

interface ArchivedItem {
  id: string;
  label: string;
  sublabel?: string;
  deletedAt: any;
}

const Archive: React.FC = () => {
  const { profile } = useAuth();
  const isWebmaster = profile?.role === "webmaster";
  const [conversations, setConversations] = useState<ArchivedItem[]>([]);
  const [escalations, setEscalations] = useState<ArchivedItem[]>([]);

  useEffect(() => {
    const qConvos = query(collection(db, "conversations"), where("archived", "==", true));
    const unsub1 = onSnapshot(
      qConvos,
      (snap) => {
        const items = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              label: data.customerName || "Unknown",
              sublabel: data.lastMessage,
              deletedAt: data.deletedAt,
            };
          })
          .filter((i) => !isExpired(i.deletedAt));
        setConversations(items);
      },
      (err) => console.error("Archive convos error:", err)
    );

    let unsub2: (() => void) | null = null;
    if (isWebmaster) {
      const qEsc = query(collection(db, "escalationRequests"), where("archived", "==", true));
      unsub2 = onSnapshot(
        qEsc,
        (snap) => {
          const items = snap.docs
            .map((d) => {
              const data = d.data() as any;
              const requester = data.requesterName || data.requesterEmail || data.requesterUid || "Unknown";
              return {
                id: d.id,
                label: `${requester} — ${data.status || "pending"}`,
                sublabel: data.reason || "(no reason)",
                deletedAt: data.deletedAt,
              };
            })
            .filter((i) => !isExpired(i.deletedAt));
          setEscalations(items);
        },
        (err) => console.error("Archive escalations error:", err)
      );
    }

    return () => {
      unsub1();
      if (unsub2) unsub2();
    };
  }, [isWebmaster]);

  const restoreConvo = async (id: string) => {
    try {
      await updateDoc(doc(db, "conversations", id), { archived: false, deletedAt: null });
      toast({ title: "Restored", description: "Conversation is back in your active list." });
    } catch (e: any) {
      toast({ title: "Restore failed", description: e?.message, variant: "destructive" });
    }
  };

  const purgeConvo = async (id: string) => {
    try {
      const msgsSnap = await getDocs(collection(db, "conversations", id, "messages"));
      const batch = writeBatch(db);
      msgsSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      await deleteDoc(doc(db, "conversations", id));
      toast({ title: "Permanently deleted", description: "Conversation has been wiped." });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  };

  const restoreEscalation = async (id: string) => {
    try {
      const fn = httpsCallable<{ requestId: string; action: "restore" }, { ok: boolean }>(
        functions,
        "manageEscalationRequest"
      );
      await fn({ requestId: id, action: "restore" });
      toast({ title: "Escalation restored", description: "Back in the active queue." });
    } catch (e: any) {
      toast({ title: "Restore failed", description: e?.message, variant: "destructive" });
    }
  };

  const purgeEscalation = async (id: string) => {
    try {
      await deleteDoc(doc(db, "escalationRequests", id));
      toast({ title: "Permanently deleted", description: "Escalation request removed." });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  };

  const renderList = (
    items: ArchivedItem[],
    icon: React.ReactNode,
    onRestore: (id: string) => void,
    onPurge: (id: string) => void
  ) => {
    if (items.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <ArchiveIcon className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Nothing archived. Archived items appear here for {ARCHIVE_RETENTION_DAYS} days.
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {items.map((item, i) => {
          const days = daysRemaining(item.deletedAt);
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                {icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{item.label}</p>
                {item.sublabel && <p className="truncate text-xs text-muted-foreground">{item.sublabel}</p>}
                <Badge variant={days <= 7 ? "destructive" : "secondary"} className="mt-1 text-[10px]">
                  {days} day{days === 1 ? "" : "s"} until permanent deletion
                </Badge>
              </div>
              <div className="flex flex-shrink-0 gap-2">
                <Button size="sm" variant="outline" onClick={() => onRestore(item.id)} className="gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" /> Restore
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Delete forever"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete forever?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes <strong>{item.label}</strong>. It cannot be restored.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => onPurge(item.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete forever
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </motion.div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="hidden md:block text-2xl font-bold text-foreground">Archive</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Items here are recoverable for {ARCHIVE_RETENTION_DAYS} days, then permanently removed.
        </p>
      </div>

      <Tabs defaultValue="conversations">
        <TabsList className="mb-4">
          <TabsTrigger value="conversations" className="gap-1.5">
            <MessageCircle className="h-3.5 w-3.5" /> Conversations
            {conversations.length > 0 && <Badge variant="secondary" className="ml-1">{conversations.length}</Badge>}
          </TabsTrigger>
          {isWebmaster && (
            <TabsTrigger value="escalations" className="gap-1.5">
              <Inbox className="h-3.5 w-3.5" /> Escalations
              {escalations.length > 0 && <Badge variant="secondary" className="ml-1">{escalations.length}</Badge>}
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="conversations">
          {renderList(conversations, <MessageCircle className="h-4 w-4" />, restoreConvo, purgeConvo)}
        </TabsContent>
        {isWebmaster && (
          <TabsContent value="escalations">
            {renderList(escalations, <Inbox className="h-4 w-4" />, restoreEscalation, purgeEscalation)}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

export default Archive;
