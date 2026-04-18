/**
 * ConversationNotes — shared note thread attached to a conversation.
 *
 * Notes live under `conversations/{id}/notes` and are visible to every
 * signed-in teammate. Any agent/admin/webmaster can create or edit a note
 * (edits are tracked with `editedAt` / `editedBy`). Only webmasters and
 * admins can permanently delete a note — agents see no Delete control to
 * keep accidental loss off the table.
 *
 * Used in two places:
 *  - Conversations.tsx  → inline composer above the status bar plus the
 *                         rendered list interleaved with the message thread.
 *  - AgentLogs.tsx      → read-only recap section under each resolved
 *                         conversation so the closing context is preserved.
 */
import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  StickyNote,
  Pencil,
  Trash2,
  Check,
  X as XIcon,
  Loader2,
} from "lucide-react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { sanitizeText } from "@/lib/validation";
import { cn } from "@/lib/utils";

export interface ConvoNote {
  id: string;
  text: string;
  authorUid: string;
  authorName: string;
  createdAt: any;
  editedAt?: any;
  editedBy?: string;
}

function formatTime(ts: any): string {
  if (!ts?.toDate) return "Just now";
  const d = ts.toDate();
  const diff = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return d.toLocaleDateString();
}

export function useConversationNotes(conversationId: string | null): {
  notes: ConvoNote[];
  loading: boolean;
} {
  const [notes, setNotes] = useState<ConvoNote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!conversationId) {
      setNotes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, "conversations", conversationId, "notes"),
      orderBy("createdAt", "asc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setNotes(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        setLoading(false);
      },
      (err) => {
        console.warn("notes listener:", err);
        setNotes([]);
        setLoading(false);
      }
    );
    return unsub;
  }, [conversationId]);

  return { notes, loading };
}

interface ConversationNotesProps {
  conversationId: string;
  /** Hide the composer (used for read-only renderings on /agent-logs). */
  readOnly?: boolean;
  /** Pre-loaded notes (skips internal listener — useful when parent already subscribes). */
  notes?: ConvoNote[];
  className?: string;
  /** Compact variant for inline rendering inside the agent-logs recap. */
  compact?: boolean;
}

const ConversationNotes: React.FC<ConversationNotesProps> = ({
  conversationId,
  readOnly = false,
  notes: providedNotes,
  className,
  compact = false,
}) => {
  const { profile, user } = useAuth();
  const internal = useConversationNotes(providedNotes ? null : conversationId);
  const notes = providedNotes ?? internal.notes;

  const canDelete =
    profile?.role === "webmaster" || profile?.role === "admin";
  const actorName =
    profile?.displayName?.trim() || profile?.email?.trim() || "Unknown";

  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const submit = async () => {
    const clean = sanitizeText(draft).trim();
    if (!clean) return;
    if (!user) {
      toast({ title: "Sign in to add notes", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, "conversations", conversationId, "notes"), {
        text: clean.slice(0, 1000),
        authorUid: user.uid,
        authorName: actorName,
        createdAt: serverTimestamp(),
      });
      setDraft("");
    } catch (e: any) {
      toast({ title: "Could not save note", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (n: ConvoNote) => {
    setEditingId(n.id);
    setEditDraft(n.text);
  };

  const saveEdit = async (id: string) => {
    const clean = sanitizeText(editDraft).trim();
    if (!clean) return;
    try {
      await updateDoc(doc(db, "conversations", conversationId, "notes", id), {
        text: clean.slice(0, 1000),
        editedAt: serverTimestamp(),
        editedBy: actorName,
      });
      setEditingId(null);
      setEditDraft("");
    } catch (e: any) {
      toast({ title: "Edit failed", description: e?.message, variant: "destructive" });
    }
  };

  const removeNote = async (id: string) => {
    if (!canDelete) return;
    try {
      await deleteDoc(doc(db, "conversations", conversationId, "notes", id));
      toast({ title: "Note deleted" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      {!compact && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <StickyNote className="h-3.5 w-3.5 text-warning" />
          Conversation notes
          {notes.length > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
              {notes.length}
            </Badge>
          )}
        </div>
      )}

      {notes.length === 0 && readOnly && (
        <p className="text-[11px] text-muted-foreground italic">No notes were left on this conversation.</p>
      )}

      <AnimatePresence initial={false}>
        {notes.map((n) => {
          const isEditing = editingId === n.id;
          return (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              className={cn(
                "rounded-lg border border-warning/30 bg-warning/5 px-3 py-2",
                compact && "py-1.5"
              )}
            >
              <div className="flex items-start gap-2">
                <StickyNote className="h-3.5 w-3.5 text-warning flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <Textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      className="min-h-[60px] text-xs"
                      autoFocus
                    />
                  ) : (
                    <p className="text-xs text-foreground whitespace-pre-wrap break-words">
                      {n.text}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="font-medium text-foreground/70">{n.authorName}</span>
                    <span>·</span>
                    <span>{formatTime(n.createdAt)}</span>
                    {n.editedAt && (
                      <>
                        <span>·</span>
                        <span className="italic">edited{n.editedBy ? ` by ${n.editedBy}` : ""}</span>
                      </>
                    )}
                  </div>
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {isEditing ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => saveEdit(n.id)}
                          aria-label="Save edit"
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => {
                            setEditingId(null);
                            setEditDraft("");
                          }}
                          aria-label="Cancel edit"
                        >
                          <XIcon className="h-3 w-3" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => startEdit(n)}
                          aria-label="Edit note"
                          title="Edit note"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        {canDelete && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                            onClick={() => removeNote(n.id)}
                            aria-label="Delete note"
                            title="Delete note (admins/webmasters only)"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {!readOnly && (
        <div className="flex items-start gap-2 pt-1">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a note about this conversation… (visible to all teammates)"
            className="min-h-[44px] text-xs resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button
            size="sm"
            onClick={submit}
            disabled={!draft.trim() || saving}
            className="h-9 flex-shrink-0"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add note"}
          </Button>
        </div>
      )}
    </div>
  );
};

export default ConversationNotes;
