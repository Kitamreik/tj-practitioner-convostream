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
import { db } from "@/lib/firebase";
import { Archive as ArchiveIcon, RotateCcw, Trash2, MessageCircle, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { daysRemaining, isExpired, ARCHIVE_RETENTION_DAYS } from "@/lib/softDelete";
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
  const [conversations, setConversations] = useState<ArchivedItem[]>([]);
  const [people, setPeople] = useState<ArchivedItem[]>([]);

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

    const qPeople = query(collection(db, "people"), where("archived", "==", true));
    const unsub2 = onSnapshot(
      qPeople,
      (snap) => {
        const items = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              label: data.name || "Unknown",
              sublabel: data.email,
              deletedAt: data.deletedAt,
            };
          })
          .filter((i) => !isExpired(i.deletedAt));
        setPeople(items);
      },
      (err) => console.error("Archive people error:", err)
    );

    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  const restore = async (col: "conversations" | "people", id: string) => {
    try {
      await updateDoc(doc(db, col, id), { archived: false, deletedAt: null });
      toast({ title: "Restored", description: "Item is back in your active list." });
    } catch (e: any) {
      toast({ title: "Restore failed", description: e?.message, variant: "destructive" });
    }
  };

  const purge = async (col: "conversations" | "people", id: string) => {
    try {
      if (col === "conversations") {
        const msgsSnap = await getDocs(collection(db, "conversations", id, "messages"));
        const batch = writeBatch(db);
        msgsSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      await deleteDoc(doc(db, col, id));
      toast({ title: "Permanently deleted", description: "Item has been wiped." });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  };

  const renderList = (items: ArchivedItem[], col: "conversations" | "people", icon: React.ReactNode) => {
    if (items.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <ArchiveIcon className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Nothing archived. Deleted items appear here for {ARCHIVE_RETENTION_DAYS} days.</p>
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
                <Button size="sm" variant="outline" onClick={() => restore(col, item.id)} className="gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" /> Restore
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label="Delete forever">
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
                        onClick={() => purge(col, item.id)}
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
          <TabsTrigger value="people" className="gap-1.5">
            <User className="h-3.5 w-3.5" /> People
            {people.length > 0 && <Badge variant="secondary" className="ml-1">{people.length}</Badge>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="conversations">{renderList(conversations, "conversations", <MessageCircle className="h-4 w-4" />)}</TabsContent>
        <TabsContent value="people">{renderList(people, "people", <User className="h-4 w-4" />)}</TabsContent>
      </Tabs>
    </div>
  );
};

export default Archive;
