import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Check, AlertCircle, MessageSquare, Phone, Trash2, Plus, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PullToRefresh from "@/components/PullToRefresh";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { sanitizeText, singleLine, safeValidate } from "@/lib/validation";
import { z } from "zod";
import { cn } from "@/lib/utils";

type NotificationType = "message" | "call" | "alert";

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  description: string;
  time: string;
  read: boolean;
  /** Notes added by the user; each tagged as a follow-up category. */
  isNote?: boolean;
}

const titleSchema = z
  .string()
  .transform((v) => singleLine(v))
  .pipe(z.string().min(1, "Title is required").max(120, "Title too long"));

const descriptionSchema = z
  .string()
  .transform((v) => sanitizeText(v))
  .pipe(z.string().max(500, "Description too long"));

const initialNotifications: Notification[] = [
  { id: "1", type: "message", title: "New message from Sarah Mitchell", description: "Replied via email about billing", time: "2 min ago", read: false },
  { id: "2", type: "call", title: "Missed call from James Rodriguez", description: "+1 555-0102 — 2m 34s", time: "15 min ago", read: false },
  { id: "3", type: "alert", title: "SLA warning: Emily Chen", description: "Response time approaching 4-hour limit", time: "1 hr ago", read: true },
  { id: "4", type: "message", title: "Slack notification sent", description: "Auto-notification to #support channel", time: "2 hrs ago", read: true },
  { id: "5", type: "message", title: "Gmail notification sent", description: "Follow-up sent to michael@example.com", time: "3 hrs ago", read: true },
];

const typeIcons: Record<NotificationType, React.ReactNode> = {
  message: <MessageSquare className="h-4 w-4" />,
  call: <Phone className="h-4 w-4" />,
  alert: <AlertCircle className="h-4 w-4" />,
};

const typeLabels: Record<NotificationType, string> = {
  message: "Follow-up text",
  call: "Follow-up call",
  alert: "Alert",
};

const Notifications: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftType, setDraftType] = useState<NotificationType>("message");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    toast({ title: "All notifications marked as read" });
  };

  const deleteNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    toast({ title: "Notification deleted" });
  };

  const openCreate = (type: NotificationType) => {
    setEditingId(null);
    setDraftType(type);
    setDraftTitle("");
    setDraftDescription("");
    setEditorOpen(true);
  };

  const openEdit = (n: Notification) => {
    setEditingId(n.id);
    setDraftType(n.type);
    setDraftTitle(n.title);
    setDraftDescription(n.description);
    setEditorOpen(true);
  };

  const handleSave = () => {
    const titleRes = safeValidate(titleSchema, draftTitle);
    if (!titleRes.ok) return toast({ title: "Invalid title", description: titleRes.error, variant: "destructive" });
    const descRes = safeValidate(descriptionSchema, draftDescription);
    if (!descRes.ok) return toast({ title: "Invalid description", description: descRes.error, variant: "destructive" });

    if (editingId) {
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === editingId
            ? { ...n, type: draftType, title: titleRes.data, description: descRes.data }
            : n
        )
      );
      toast({ title: "Notification updated" });
    } else {
      const newNote: Notification = {
        id: `note-${Date.now()}`,
        type: draftType,
        title: titleRes.data,
        description: descRes.data,
        time: "Just now",
        read: false,
        isNote: true,
      };
      setNotifications((prev) => [newNote, ...prev]);
      toast({ title: "Note added", description: typeLabels[draftType] });
    }
    setEditorOpen(false);
  };

  const isMobile = useIsMobile();
  const handleRefresh = async () => {
    await new Promise((r) => setTimeout(r, 600));
    toast({ title: "Refreshed", description: "Notifications are up to date." });
  };

  return (
    <PullToRefresh onRefresh={handleRefresh} disabled={!isMobile} className="h-full">
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6 md:mb-8 gap-3">
          <div className="min-w-0">
            <h1 className="hidden md:block text-2xl font-bold text-foreground">Notifications</h1>
            <p className="text-muted-foreground mt-1 text-sm md:text-base">Stay on top of every interaction</p>
          </div>
          <Button variant="outline" size="sm" className="gap-2 flex-shrink-0" onClick={markAllRead}>
            <Check className="h-4 w-4" />
            <span className="hidden sm:inline">Mark all read</span>
          </Button>
        </div>

        {/* Quick-add note: tag by icon */}
        <div className="mb-4 rounded-xl border border-border bg-card/50 p-3 md:p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs md:text-sm font-medium text-foreground flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add a follow-up note
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(typeIcons) as NotificationType[]).map((t) => (
              <Button
                key={t}
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => openCreate(t)}
                aria-label={`Add ${typeLabels[t]}`}
              >
                {typeIcons[t]}
                <span className="text-xs">{typeLabels[t]}</span>
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <AnimatePresence>
            {notifications.length === 0 && (
              <div className="text-center py-12 text-muted-foreground flex flex-col items-center gap-2">
                <Bell className="h-8 w-8 opacity-30" />
                <span>No notifications</span>
              </div>
            )}
            {notifications.map((n, i) => (
              <motion.div
                key={n.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10, height: 0, marginBottom: 0, padding: 0, overflow: "hidden" }}
                transition={{ delay: i * 0.04 }}
                className={cn(
                  "flex items-start gap-3 md:gap-4 rounded-xl border p-3 md:p-4 transition-colors",
                  n.read ? "border-border bg-card" : "border-primary/30 bg-primary/5"
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg",
                    n.read ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
                  )}
                >
                  {typeIcons[n.type]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn("text-sm break-words", n.read ? "text-foreground" : "font-medium text-foreground")}>
                      {n.title}
                    </p>
                    <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">{n.time}</span>
                  </div>
                  {n.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 break-words">{n.description}</p>
                  )}
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
                      {typeLabels[n.type]}
                    </span>
                    {n.isNote && (
                      <span className="text-[10px] uppercase tracking-wider rounded bg-accent/40 px-1.5 py-0.5 text-accent-foreground">
                        Note
                      </span>
                    )}
                    {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => openEdit(n)}
                    aria-label="Edit notification"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteNotification(n.id)}
                    aria-label="Delete notification"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit notification" : "New follow-up note"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Type</Label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(typeIcons) as NotificationType[]).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant={draftType === t ? "default" : "outline"}
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setDraftType(t)}
                  >
                    {typeIcons[t]}
                    <span className="text-xs">{typeLabels[t]}</span>
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Follow up with Sarah about pricing"
                maxLength={120}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                placeholder="Optional details — what to mention, when to call, etc."
                rows={4}
                maxLength={500}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditorOpen(false)} className="gap-1.5">
                <X className="h-4 w-4" /> Cancel
              </Button>
              <Button onClick={handleSave} disabled={!draftTitle.trim()}>
                {editingId ? "Save changes" : "Add note"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PullToRefresh>
  );
};

export default Notifications;
