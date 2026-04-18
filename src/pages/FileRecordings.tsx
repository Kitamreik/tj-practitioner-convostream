import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  FileVideo,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Wrench,
  Activity,
  Link as LinkIcon,
  Image as ImageIcon,
  MessageSquarePlus,
  ExternalLink,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  FileRecording,
  RecordingStatus,
  addNote,
  addRecording,
  deleteNote,
  deleteRecording,
  listRecordings,
  subscribeRecordings,
  updateRecording,
} from "@/lib/fileRecordings";
import { notifyAllUsers } from "@/lib/notifyAll";

const STATUS_META: Record<
  RecordingStatus,
  { label: string; icon: React.ReactNode; className: string }
> = {
  ongoing: {
    label: "Ongoing",
    icon: <Activity className="h-3 w-3" />,
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  },
  maintenance: {
    label: "Maintenance",
    icon: <Wrench className="h-3 w-3" />,
    className: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  },
  resolved: {
    label: "Resolved",
    icon: <CheckCircle2 className="h-3 w-3" />,
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  },
};

function formatRel(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

const MAX_IMAGE_BYTES = 400_000; // ~400 KB per image to keep localStorage healthy

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

const FileRecordings: React.FC = () => {
  const { profile } = useAuth();
  const role = profile?.role ?? "agent";
  const canEdit = role === "admin" || role === "webmaster";

  const [items, setItems] = useState<FileRecording[]>(() => listRecordings());

  useEffect(() => subscribeRecordings(() => setItems(listRecordings())), []);

  // Editor dialog state
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [linksText, setLinksText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [status, setStatus] = useState<RecordingStatus>("ongoing");
  const [submitting, setSubmitting] = useState(false);

  // Per-card note draft
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const grouped = useMemo(() => {
    const active = items.filter((r) => r.status !== "resolved");
    const resolved = items.filter((r) => r.status === "resolved");
    return { active, resolved };
  }, [items]);

  const reset = () => {
    setEditingId(null);
    setTitle("");
    setDescription("");
    setVideoUrl("");
    setLinksText("");
    setImages([]);
    setStatus("ongoing");
  };

  const openCreate = () => {
    reset();
    setOpen(true);
  };

  const openEdit = (r: FileRecording) => {
    setEditingId(r.id);
    setTitle(r.title);
    setDescription(r.description);
    setVideoUrl(r.videoUrl ?? "");
    setLinksText(r.links.join("\n"));
    setImages(r.images);
    setStatus(r.status);
    setOpen(true);
  };

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const additions: string[] = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > MAX_IMAGE_BYTES) {
        toast({
          title: "Image too large",
          description: `${f.name} is over ${Math.round(MAX_IMAGE_BYTES / 1024)} KB.`,
          variant: "destructive",
        });
        continue;
      }
      try {
        additions.push(await fileToDataUrl(f));
      } catch {
        // skip bad file
      }
    }
    if (additions.length) setImages((prev) => [...prev, ...additions]);
  };

  const handleSave = async () => {
    if (!profile) {
      toast({ title: "Sign in required", variant: "destructive" });
      return;
    }
    const t = title.trim();
    if (!t) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const links = linksText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      if (editingId) {
        if (!canEdit) {
          toast({ title: "Not allowed", description: "Only admins or webmasters can edit.", variant: "destructive" });
        } else {
          updateRecording(editingId, {
            title: t,
            description: description.trim(),
            videoUrl: videoUrl.trim() || undefined,
            links,
            images,
            status,
          });
          toast({ title: "Recording updated" });
        }
      } else {
        addRecording({
          title: t,
          description: description.trim(),
          videoUrl: videoUrl.trim() || undefined,
          links,
          images,
          status,
          uploaderUid: profile.uid,
          uploaderName: profile.displayName || profile.email || "Unknown",
          uploaderRole: role,
        });
        toast({ title: "Recording uploaded" });
        // Fan-out a notification to everyone.
        notifyAllUsers({
          type: "alert",
          title: `New file recording: ${t}`,
          description: `${profile.displayName || profile.email} uploaded a recording (${status}).`,
          link: "/file-recordings",
        }).catch(() => undefined);
      }
      setOpen(false);
      reset();
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (r: FileRecording) => {
    if (!canEdit) return;
    if (!confirm(`Delete "${r.title}"? This cannot be undone.`)) return;
    deleteRecording(r.id);
    toast({ title: "Recording deleted" });
  };

  const handleStatus = (r: FileRecording, next: RecordingStatus) => {
    if (!canEdit) return;
    updateRecording(r.id, { status: next });
  };

  const handleAddNote = (r: FileRecording) => {
    if (!profile) return;
    const body = (noteDrafts[r.id] ?? "").trim();
    if (!body) return;
    addNote(r.id, {
      authorUid: profile.uid,
      authorName: profile.displayName || profile.email || "Unknown",
      body,
    });
    setNoteDrafts((d) => ({ ...d, [r.id]: "" }));
  };

  const renderCard = (r: FileRecording, idx: number) => {
    const meta = STATUS_META[r.status] ?? STATUS_META.ongoing;
    return (
      <motion.div
        key={r.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: idx * 0.03 }}
        className="rounded-xl border border-border bg-card p-4 space-y-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground break-words">
                {r.title}
              </h3>
              <Badge variant="outline" className={`text-[10px] gap-1 ${meta.className}`}>
                {meta.icon}
                {meta.label}
              </Badge>
              <Badge variant="secondary" className="text-[10px] capitalize">
                {r.uploaderRole}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              by {r.uploaderName} · {formatRel(r.createdAt)}
              {r.updatedAt !== r.createdAt && ` · edited ${formatRel(r.updatedAt)}`}
            </p>
          </div>
          {canEdit && (
            <div className="flex flex-shrink-0 items-center gap-1.5">
              <Select value={r.status} onValueChange={(v) => handleStatus(r, v as RecordingStatus)}>
                <SelectTrigger className="h-7 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ongoing">Ongoing</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => openEdit(r)}
                aria-label="Edit recording"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(r)}
                aria-label="Delete recording"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        {r.description && (
          <p className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed">
            {r.description}
          </p>
        )}

        {r.videoUrl && (
          <a
            href={r.videoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <FileVideo className="h-3.5 w-3.5" /> Open video
            <ExternalLink className="h-3 w-3" />
          </a>
        )}

        {r.links.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {r.links.map((l, i) => (
              <a
                key={i}
                href={l}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-foreground hover:bg-muted"
              >
                <LinkIcon className="h-3 w-3" />
                <span className="max-w-[180px] truncate">{l}</span>
              </a>
            ))}
          </div>
        )}

        {r.images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {r.images.map((src, i) => (
              <a
                key={i}
                href={src}
                target="_blank"
                rel="noreferrer"
                className="block h-20 w-20 overflow-hidden rounded-md border border-border"
              >
                <img src={src} alt={`Attachment ${i + 1}`} className="h-full w-full object-cover" />
              </a>
            ))}
          </div>
        )}

        {/* Notes */}
        <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Agent notes ({r.notes.length})
          </p>
          {r.notes.length > 0 && (
            <ul className="mb-2 space-y-2">
              {r.notes.map((n) => {
                const canRemove =
                  canEdit || n.authorUid === profile?.uid;
                return (
                  <li
                    key={n.id}
                    className="flex items-start justify-between gap-2 rounded-md bg-card px-2.5 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{n.authorName}</p>
                      <p className="text-muted-foreground">{formatRel(n.createdAt)}</p>
                      <p className="mt-1 whitespace-pre-wrap text-foreground/90">{n.body}</p>
                    </div>
                    {canRemove && (
                      <button
                        onClick={() => deleteNote(r.id, n.id)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Remove note"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {profile && (
            <div className="flex items-end gap-2">
              <Textarea
                value={noteDrafts[r.id] ?? ""}
                onChange={(e) => setNoteDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                placeholder="Add a note for this recording…"
                className="min-h-[40px] flex-1 text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleAddNote(r)}
                disabled={!(noteDrafts[r.id] ?? "").trim()}
                className="gap-1.5"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24 md:pb-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <FileVideo className="h-7 w-7 text-primary" />
            File Recording Vault
          </h1>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">
            Share videos, images, and reference links. {canEdit ? "Admins and webmasters can edit or delete entries." : "Agents can add notes."}
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> New recording
        </Button>
      </div>

      {role === "agent" && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-200">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold">Double-check before you upload.</p>
            <p className="text-xs mt-0.5 opacity-90">
              Once submitted, agents cannot edit or replace recordings. Only an admin or webmaster can fix mistakes.
            </p>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <FileVideo className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">No recordings yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Click "New recording" to upload the first one.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.active.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Active
              </h2>
              <div className="space-y-3">
                {grouped.active.map((r, i) => renderCard(r, i))}
              </div>
            </section>
          )}
          {grouped.resolved.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Resolved
              </h2>
              <div className="space-y-3 opacity-80">
                {grouped.resolved.map((r, i) => renderCard(r, i))}
              </div>
            </section>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit recording" : "New file recording"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {!editingId && role === "agent" && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>Make sure the title, video link, and attachments are correct — you won't be able to edit this entry yourself.</span>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-foreground">Title</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" disabled={submitting} placeholder="e.g. Onboarding demo for Acme" />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground">Description</label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 min-h-[80px]" disabled={submitting} placeholder="Context, what to look for, action items…" />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground">Video URL (Drive / YouTube / Dropbox)</label>
              <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} className="mt-1" disabled={submitting} placeholder="https://…" />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground">Reference links (one per line)</label>
              <Textarea value={linksText} onChange={(e) => setLinksText(e.target.value)} className="mt-1 min-h-[60px] font-mono text-xs" disabled={submitting} placeholder={"https://example.com/doc-1\nhttps://example.com/doc-2"} />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground flex items-center gap-2">
                <ImageIcon className="h-3.5 w-3.5" /> Images (≤ {Math.round(MAX_IMAGE_BYTES / 1024)} KB each)
              </label>
              <Input type="file" accept="image/*" multiple onChange={handleImagePick} className="mt-1" disabled={submitting} />
              {images.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {images.map((src, i) => (
                    <div key={i} className="relative h-16 w-16 overflow-hidden rounded-md border border-border">
                      <img src={src} alt={`Selected ${i + 1}`} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute right-0 top-0 rounded-bl-md bg-background/80 p-0.5 text-muted-foreground hover:text-destructive"
                        aria-label="Remove image"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-foreground">Status</label>
              <Select value={status} onValueChange={(v) => setStatus(v as RecordingStatus)} disabled={submitting}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ongoing">Ongoing</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={handleSave} disabled={submitting} className="gap-2">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingId ? "Save changes" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FileRecordings;
