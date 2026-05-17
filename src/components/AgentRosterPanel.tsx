/**
 * Agent Roster management — webmaster/admin only. Used as the verification
 * source when a new account signs up. Roster entries hold a legal name,
 * preferred name, comma-separated aliases, and an optional email.
 */
import React, { useEffect, useMemo, useState } from "react";
import { UserCheck, Plus, Pencil, Trash2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  addRosterEntry,
  removeRosterEntry,
  subscribeAgentRoster,
  updateRosterEntry,
  type RosterEntry,
} from "@/lib/agentRoster";

const AgentRosterPanel: React.FC = () => {
  const { profile } = useAuth();
  const canEdit = profile?.role === "webmaster" || profile?.role === "admin";
  const [rows, setRows] = useState<RosterEntry[]>([]);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RosterEntry | null>(null);
  const [form, setForm] = useState({
    legalName: "",
    preferredName: "",
    aliases: "",
    email: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => subscribeAgentRoster(setRows), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.legalName, r.preferredName ?? "", r.email ?? "", ...(r.aliases ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [rows, search]);

  const openCreate = () => {
    setEditing(null);
    setForm({ legalName: "", preferredName: "", aliases: "", email: "" });
    setDialogOpen(true);
  };
  const openEdit = (entry: RosterEntry) => {
    setEditing(entry);
    setForm({
      legalName: entry.legalName,
      preferredName: entry.preferredName ?? "",
      aliases: (entry.aliases ?? []).join(", "),
      email: entry.email ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.legalName.trim()) {
      toast({ title: "Legal name is required", variant: "destructive" });
      return;
    }
    if (!profile) return;
    setSaving(true);
    try {
      const aliases = form.aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      if (editing) {
        await updateRosterEntry(editing.id, {
          legalName: form.legalName,
          preferredName: form.preferredName,
          aliases,
          email: form.email,
        });
        toast({ title: "Roster entry updated" });
      } else {
        await addRosterEntry(
          {
            legalName: form.legalName,
            preferredName: form.preferredName,
            aliases,
            email: form.email,
          },
          profile.uid
        );
        toast({ title: "Roster entry added" });
      }
      setDialogOpen(false);
    } catch (e) {
      toast({
        title: "Could not save",
        description: (e as Error)?.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await removeRosterEntry(id);
      toast({ title: "Entry removed" });
    } catch (e) {
      toast({
        title: "Could not remove",
        description: (e as Error)?.message,
        variant: "destructive",
      });
    }
  };

  if (!canEdit) return null;

  return (
    <div id="agent-roster" className="rounded-xl border border-border bg-card p-4 sm:p-6">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground">
            <UserCheck className="h-5 w-5 text-primary" />
            Agent roster
            <Badge variant="secondary" className="ml-1">{rows.length}</Badge>
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Verification source for new signups. When a new account signs up, their display name
            is matched against this list before they can access the platform.
          </p>
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1.5 shrink-0">
          <Plus className="h-4 w-4" /> Add entry
        </Button>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search roster..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? "No roster entries yet. Add agents here to enable signup verification."
            : "No entries match your search."}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {filtered.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground truncate">{entry.legalName}</span>
                  {entry.preferredName && (
                    <Badge variant="outline" className="text-[10px]">
                      Preferred: {entry.preferredName}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {entry.email || "no email on file"}
                  {entry.aliases && entry.aliases.length > 0
                    ? ` · aliases: ${entry.aliases.join(", ")}`
                    : ""}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => openEdit(entry)} className="gap-1">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDelete(entry.id)}
                className="gap-1 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit roster entry" : "Add roster entry"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="legal-name">Legal name *</Label>
              <Input
                id="legal-name"
                value={form.legalName}
                onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))}
                placeholder="e.g. Alex Morgan"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="preferred-name">Preferred name</Label>
              <Input
                id="preferred-name"
                value={form.preferredName}
                onChange={(e) => setForm((f) => ({ ...f, preferredName: e.target.value }))}
                placeholder="e.g. Alex"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="aliases">Aliases (comma-separated)</Label>
              <Input
                id="aliases"
                value={form.aliases}
                onChange={(e) => setForm((f) => ({ ...f, aliases: e.target.value }))}
                placeholder="e.g. AM, Alex M, A.Morgan"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email">Pre-registered email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AgentRosterPanel;
