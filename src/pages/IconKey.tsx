/**
 * IconKey — a single page that documents every icon used across ConvoHub
 * (channels, conversation status, navigation, broadcast types). The
 * description for each icon is editable by admins and webmasters and
 * persists to `iconDescriptions/{iconKey}` so the team can keep the legend
 * in sync as new icons are introduced.
 *
 * Plain agents see read-only descriptions.
 */
import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  MessageSquare,
  Phone,
  Mail,
  Footprints,
  MessageCircle,
  Users,
  Bell,
  BarChart3,
  Plug,
  Shield,
  Megaphone,
  FileVideo,
  ScrollText,
  Archive as ArchiveIcon,
  Settings as SettingsIcon,
  StickyNote,
  Activity,
  KeyRound,
  Pencil,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { RotateCcw } from "lucide-react";

interface IconRow {
  key: string;
  label: string;
  group: "Channel" | "Status" | "Navigation" | "Broadcast" | "Action";
  icon: React.ReactNode;
  defaultDescription: string;
}

// The canonical icon catalogue. Add a row here whenever a new icon enters
// the product so the legend stays exhaustive. Keys are stable Firestore doc
// IDs — never rename without a migration.
const ICON_ROWS: IconRow[] = [
  // ---- Channels ----
  {
    key: "channel-mobile",
    label: "Mobile (in-app capture)",
    group: "Channel",
    icon: <Footprints className="h-5 w-5" />,
    defaultDescription:
      "Conversation created directly from the ConvoHub conversation page — typically by an agent capturing a thread on the move.",
  },
  {
    key: "channel-email",
    label: "Email",
    group: "Channel",
    icon: <Mail className="h-5 w-5" />,
    defaultDescription: "Inbound or outbound email thread, usually synced from a connected Gmail inbox.",
  },
  {
    key: "channel-sms",
    label: "SMS",
    group: "Channel",
    icon: <MessageSquare className="h-5 w-5" />,
    defaultDescription: "Text-message conversation routed through Twilio or Google Voice.",
  },
  {
    key: "channel-phone",
    label: "Phone",
    group: "Channel",
    icon: <Phone className="h-5 w-5" />,
    defaultDescription: "Voice call logged against a customer record.",
  },
  {
    key: "channel-slack",
    label: "Slack",
    group: "Channel",
    icon: <MessageCircle className="h-5 w-5" />,
    defaultDescription: "Conversation that originated in (or threads back to) a connected Slack channel.",
  },

  // ---- Status (color cues live in the conversation list) ----
  {
    key: "status-active",
    label: "Active",
    group: "Status",
    icon: <span className="inline-block h-3 w-3 rounded-full bg-success" />,
    defaultDescription: "Live conversation currently being worked by an agent.",
  },
  {
    key: "status-waiting",
    label: "Waiting",
    group: "Status",
    icon: <span className="inline-block h-3 w-3 rounded-full bg-warning" />,
    defaultDescription: "Customer has replied and is waiting for an agent response.",
  },
  {
    key: "status-resolved",
    label: "Resolved",
    group: "Status",
    icon: <span className="inline-block h-3 w-3 rounded-full bg-muted-foreground" />,
    defaultDescription: "Thread has been closed out — visible in /agent-logs.",
  },

  // ---- Navigation ----
  { key: "nav-conversations", label: "Conversations", group: "Navigation", icon: <MessageCircle className="h-5 w-5" />, defaultDescription: "Main inbox of customer threads." },
  { key: "nav-agents", label: "Agents", group: "Navigation", icon: <Users className="h-5 w-5" />, defaultDescription: "Roster of teammates and their assignments." },
  { key: "nav-agent-logs", label: "Agent Logs", group: "Navigation", icon: <ScrollText className="h-5 w-5" />, defaultDescription: "Audit-friendly view of every resolved conversation per agent." },
  { key: "nav-staff-updates", label: "Staff Updates", group: "Navigation", icon: <Megaphone className="h-5 w-5" />, defaultDescription: "Webmaster-authored announcements visible to the whole team." },
  { key: "nav-file-recordings", label: "File Recordings", group: "Navigation", icon: <FileVideo className="h-5 w-5" />, defaultDescription: "Shared screen captures and media drops." },
  { key: "nav-notifications", label: "Notifications", group: "Navigation", icon: <Bell className="h-5 w-5" />, defaultDescription: "Per-user notification feed; bell shows unread count." },
  { key: "nav-integrations", label: "Integrations", group: "Navigation", icon: <Plug className="h-5 w-5" />, defaultDescription: "Webmaster panel for connecting Slack, Gmail, Twilio, Google Voice." },
  { key: "nav-audit", label: "Audit Logs", group: "Navigation", icon: <Shield className="h-5 w-5" />, defaultDescription: "Webmaster-only access log of sign-ins and privileged actions." },
  { key: "nav-analytics", label: "Analytics", group: "Navigation", icon: <BarChart3 className="h-5 w-5" />, defaultDescription: "Volume and response-time charts across channels." },
  { key: "nav-archive", label: "Archive", group: "Navigation", icon: <ArchiveIcon className="h-5 w-5" />, defaultDescription: "Archived conversations kept out of the main inbox." },
  { key: "nav-settings", label: "Settings", group: "Navigation", icon: <SettingsIcon className="h-5 w-5" />, defaultDescription: "Personal profile, theme, and notification preferences." },
  { key: "nav-icon-key", label: "Icon Key", group: "Navigation", icon: <KeyRound className="h-5 w-5" />, defaultDescription: "This page — legend for every icon in ConvoHub." },

  // ---- Broadcast / contextual ----
  { key: "broadcast-notes", label: "Conversation notes", group: "Broadcast", icon: <StickyNote className="h-5 w-5 text-warning" />, defaultDescription: "Shared notes attached to a conversation. Number badge = note count." },
  { key: "broadcast-health", label: "Integrations health", group: "Broadcast", icon: <Activity className="h-5 w-5" />, defaultDescription: "Last health-check result for connected integrations (red dot = failure)." },
];

interface StoredDescription {
  description: string;
  updatedAt?: any;
  updatedByName?: string | null;
}

const IconKey: React.FC = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const canEdit = profile?.role === "admin" || profile?.role === "webmaster";

  const [stored, setStored] = useState<Record<string, StoredDescription>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Live-subscribe to the descriptions collection. Doc-per-icon means we
  // only re-render the rows that actually changed (and missing docs simply
  // fall back to the in-code default).
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "iconDescriptions"),
      (snap) => {
        const next: Record<string, StoredDescription> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as StoredDescription;
          if (typeof data.description === "string") {
            next[d.id] = data;
          }
        });
        setStored(next);
      },
      (err) => console.warn("iconDescriptions listener:", err)
    );
    return unsub;
  }, []);

  const grouped = useMemo(() => {
    const out: Record<string, IconRow[]> = {};
    ICON_ROWS.forEach((r) => {
      out[r.group] ??= [];
      out[r.group].push(r);
    });
    return out;
  }, []);

  const startEdit = (row: IconRow) => {
    setEditingKey(row.key);
    setDraft(stored[row.key]?.description ?? row.defaultDescription);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setDraft("");
  };

  const saveEdit = async (row: IconRow) => {
    const trimmed = draft.trim();
    if (!trimmed) {
      toast({ title: "Description can't be empty", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await setDoc(doc(db, "iconDescriptions", row.key), {
        description: trimmed,
        updatedAt: serverTimestamp(),
        updatedByName: profile?.displayName ?? profile?.email ?? null,
        updatedByUid: profile?.uid ?? null,
      });
      toast({ title: "Description saved", description: row.label });
      cancelEdit();
    } catch (e: any) {
      toast({
        title: "Couldn't save",
        description: e?.message ?? "Check your permissions and try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container mx-auto max-w-4xl p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h1
          className="text-3xl font-bold text-foreground flex items-center gap-3"
          style={{ fontFamily: "'Playfair Display', serif" }}
        >
          <KeyRound className="h-7 w-7 text-primary" />
          Icon Key
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Reference for every icon used across ConvoHub.{" "}
          {canEdit ? (
            <span className="text-foreground font-medium">
              You can edit any description — changes persist for the whole team.
            </span>
          ) : (
            <span>Only admins and webmasters can edit descriptions.</span>
          )}
        </p>
      </motion.div>

      {/* Quick legend strip at the top so users get the gist before scrolling. */}
      <div className="mb-8 rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Quick legend
        </h2>
        <div className="flex flex-wrap gap-2">
          {ICON_ROWS.map((r) => (
            <div
              key={`legend-${r.key}`}
              className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs"
              title={stored[r.key]?.description ?? r.defaultDescription}
            >
              <span className="text-foreground">{r.icon}</span>
              <span className="text-muted-foreground">{r.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Grouped editable list. */}
      <div className="space-y-6">
        {Object.entries(grouped).map(([group, rows]) => (
          <section key={group} className="rounded-xl border border-border bg-card">
            <header className="flex items-center justify-between border-b border-border px-5 py-3">
              <h3 className="text-sm font-semibold text-card-foreground">{group}</h3>
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                {rows.length} icon{rows.length === 1 ? "" : "s"}
              </Badge>
            </header>
            <ul className="divide-y divide-border">
              {rows.map((row) => {
                const desc = stored[row.key]?.description ?? row.defaultDescription;
                const isEditing = editingKey === row.key;
                const isCustom = !!stored[row.key];
                return (
                  <li key={row.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                    <div className="flex w-44 flex-shrink-0 items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted/40 text-foreground">
                        {row.icon}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-card-foreground">{row.label}</p>
                        {isCustom && (
                          <span className="text-[10px] uppercase tracking-wider text-primary">
                            Edited
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="space-y-2">
                          <Textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            rows={3}
                            className="text-sm"
                            disabled={saving}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => saveEdit(row)}
                              disabled={saving}
                              className="gap-1.5"
                            >
                              {saving ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={cancelEdit}
                              disabled={saving}
                              className="gap-1.5"
                            >
                              <X className="h-3.5 w-3.5" />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-3">
                          <p className="flex-1 text-sm text-muted-foreground">{desc}</p>
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => startEdit(row)}
                              className="gap-1.5 flex-shrink-0"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                          )}
                        </div>
                      )}
                      {stored[row.key]?.updatedByName && !isEditing && (
                        <p className="mt-1 text-[11px] text-muted-foreground/80">
                          Last edited by {stored[row.key].updatedByName}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
};

export default IconKey;
