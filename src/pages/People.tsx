import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Search, Trash2, Pencil, ArchiveRestore } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { collection, query, orderBy, onSnapshot, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import NewPersonDialog from "@/components/NewPersonDialog";
import EditPersonDialog, { type EditablePerson } from "@/components/EditPersonDialog";
import PullToRefresh from "@/components/PullToRefresh";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { restoreItem, isExpired, daysRemaining } from "@/lib/softDelete";
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

interface Person {
  id: string;
  name: string;
  email: string;
  phone: string;
  conversations: number;
  lastActive: any;
  tags: string[];
}

const fallbackPeople: Person[] = [
  { id: "1", name: "Sarah Mitchell", email: "sarah@example.com", phone: "+1 555-0101", conversations: 12, lastActive: null, tags: ["VIP", "Premium"] },
  { id: "2", name: "James Rodriguez", email: "james@example.com", phone: "+1 555-0102", conversations: 8, lastActive: null, tags: ["New"] },
  { id: "3", name: "Emily Chen", email: "emily@example.com", phone: "+1 555-0103", conversations: 23, lastActive: null, tags: ["Enterprise"] },
  { id: "4", name: "Michael Brown", email: "michael@example.com", phone: "+1 555-0104", conversations: 5, lastActive: null, tags: [] },
  { id: "5", name: "Lisa Anderson", email: "lisa@example.com", phone: "+1 555-0105", conversations: 17, lastActive: null, tags: ["VIP"] },
];

function formatLastActive(ts: any): string {
  if (!ts) return "—";
  if (ts?.toDate) {
    const d = ts.toDate();
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hr ago`;
    return `${Math.floor(diffHr / 24)} day(s) ago`;
  }
  return String(ts);
}

const People: React.FC = () => {
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState("");
  const [usingFallback, setUsingFallback] = useState(false);
  const [editPerson, setEditPerson] = useState<EditablePerson | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const openEdit = (p: Person) => {
    setEditPerson({ id: p.id, name: p.name, email: p.email, phone: p.phone, tags: p.tags });
    setEditOpen(true);
  };

  const handleLocalEdit = (updated: EditablePerson) => {
    setPeople((prev) =>
      prev.map((p) =>
        p.id === updated.id
          ? { ...p, name: updated.name, email: updated.email || "", phone: updated.phone || "", tags: updated.tags || [] }
          : p
      )
    );
  };

  useEffect(() => {
    const q = query(collection(db, "people"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        if (snapshot.empty) {
          setPeople(fallbackPeople);
          setUsingFallback(true);
        } else {
          const docs = snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() } as Person & { archived?: boolean; deletedAt?: any }))
            .filter((p) => (showArchived ? p.archived && !isExpired(p.deletedAt) : !p.archived));
          setPeople(docs as Person[]);
          setUsingFallback(false);
        }
      },
      (error) => {
        console.error("People listener error:", error);
        setPeople(fallbackPeople);
        setUsingFallback(true);
      }
    );
    return unsub;
  }, [showArchived]);

  const filtered = people.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.email.toLowerCase().includes(search.toLowerCase()) ||
      p.phone.includes(search)
  );

  const isMobile = useIsMobile();
  const handleRefresh = async () => {
    await new Promise((r) => setTimeout(r, 600));
    toast({ title: "Refreshed", description: "People list is up to date." });
  };

  const handleDelete = async (person: Person) => {
    if (usingFallback) {
      setPeople((prev) => prev.filter((p) => p.id !== person.id));
      toast({ title: "Profile archived", description: `${person.name}'s profile moved to Archive (local).` });
      return;
    }
    try {
      await updateDoc(doc(db, "people", person.id), {
        archived: true,
        deletedAt: serverTimestamp(),
      });
      toast({
        title: "Profile archived",
        description: `${person.name}'s profile is restorable from Archive for 30 days.`,
      });
    } catch (e: any) {
      console.error(e);
      toast({ title: "Archive failed", description: e?.message, variant: "destructive" });
    }
  };

  const DeleteButton: React.FC<{ person: Person; compact?: boolean }> = ({ person, compact }) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon" : "sm"}
          className={compact ? "h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive" : "text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5"}
          aria-label={`Delete ${person.name}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {!compact && "Delete"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive this profile?</AlertDialogTitle>
          <AlertDialogDescription>
            <strong>{person.name}</strong>'s profile will be hidden from your People list. You can restore it from the Archive page within 30 days, after which it is permanently deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => handleDelete(person)}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Archive profile
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <PullToRefresh onRefresh={handleRefresh} disabled={!isMobile} className="h-full">
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 md:mb-8">
        <div>
          <h1 className="hidden md:block text-2xl font-bold text-foreground">People</h1>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">Unified view of every customer</p>
        </div>
        <NewPersonDialog />
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search people..."
          className="pl-9 max-w-md"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-2">
        {filtered.map((person, i) => (
          <motion.div
            key={person.id}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className="rounded-xl border border-border bg-card p-4"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {person.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-foreground truncate">{person.name}</p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Edit ${person.name}`}
                      onClick={() => openEdit(person)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <DeleteButton person={person} compact />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground truncate">{person.email}</p>
                <p className="text-xs text-muted-foreground">{person.phone}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">{person.conversations} threads</span>
                  <span className="text-muted-foreground">· {formatLastActive(person.lastActive)}</span>
                </div>
                {(person.tags || []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(person.tags || []).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Person</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Contact</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Threads</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Last Active</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Tags</th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((person, i) => (
              <motion.tr
                key={person.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {person.name.charAt(0)}
                    </div>
                    <span className="font-medium text-foreground">{person.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm text-foreground">{person.email}</p>
                  <p className="text-xs text-muted-foreground">{person.phone}</p>
                </td>
                <td className="px-6 py-4 text-sm text-foreground">{person.conversations}</td>
                <td className="px-6 py-4 text-sm text-muted-foreground">{formatLastActive(person.lastActive)}</td>
                <td className="px-6 py-4">
                  <div className="flex gap-1">
                    {(person.tags || []).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Edit ${person.name}`}
                      onClick={() => openEdit(person)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <DeleteButton person={person} compact />
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      <EditPersonDialog
        person={editPerson}
        open={editOpen}
        onOpenChange={setEditOpen}
        localOnly={usingFallback}
        onLocalSave={handleLocalEdit}
      />
    </div>
    </PullToRefresh>
  );
};

export default People;
