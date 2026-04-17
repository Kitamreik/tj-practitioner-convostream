import React, { useState, useEffect } from "react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { nameSchema, emailSchema, phoneSchema, tagsSchema, safeValidate } from "@/lib/validation";
import { syncPeopleByEmail, syncConversationsByEmail } from "@/lib/profileSync";

export interface EditablePerson {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  tags?: string[];
}

interface EditPersonDialogProps {
  person: EditablePerson | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When true, the doc is a mock (not in Firestore) — only update locally. */
  localOnly?: boolean;
  onLocalSave?: (updated: EditablePerson) => void;
}

const EditPersonDialog: React.FC<EditPersonDialogProps> = ({
  person,
  open,
  onOpenChange,
  localOnly,
  onLocalSave,
}) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [tags, setTags] = useState("");

  useEffect(() => {
    if (person && open) {
      setName(person.name || "");
      setEmail(person.email || "");
      setPhone(person.phone || "");
      setTags((person.tags || []).join(", "));
    }
  }, [person, open]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!person) return;

    const nameRes = safeValidate(nameSchema, name);
    if (!nameRes.ok) return toast({ title: "Invalid name", description: nameRes.error, variant: "destructive" });

    let cleanEmail = "";
    if (email.trim()) {
      const r = safeValidate(emailSchema, email);
      if (!r.ok) return toast({ title: "Invalid email", description: r.error, variant: "destructive" });
      cleanEmail = r.data;
    }

    let cleanPhone = "";
    if (phone.trim()) {
      const r = safeValidate(phoneSchema, phone);
      if (!r.ok) return toast({ title: "Invalid phone", description: r.error, variant: "destructive" });
      cleanPhone = r.data;
    }

    const tagsRes = safeValidate(tagsSchema, tags);
    if (!tagsRes.ok) return toast({ title: "Invalid tags", description: tagsRes.error, variant: "destructive" });

    const updated: EditablePerson = {
      id: person.id,
      name: nameRes.data,
      email: cleanEmail,
      phone: cleanPhone,
      tags: tagsRes.data,
    };

    setLoading(true);
    try {
      if (localOnly) {
        // Editing through a Conversation modal: persist locally + auto-sync any
        // matching People record by email so both sides stay aligned.
        onLocalSave?.(updated);
        let synced = 0;
        if (cleanEmail) {
          synced = await syncPeopleByEmail(cleanEmail, {
            name: updated.name,
            email: cleanEmail,
            phone: cleanPhone,
          });
        }
        toast({
          title: "Profile updated",
          description: synced > 0 ? `Synced to ${synced} matching People record${synced === 1 ? "" : "s"}.` : undefined,
        });
      } else {
        await updateDoc(doc(db, "people", person.id), {
          name: updated.name,
          email: updated.email,
          phone: updated.phone,
          tags: updated.tags,
          updatedAt: serverTimestamp(),
        });
        // Editing through People: push name/email/phone to any conversations
        // for the same email so the thread headers stay current.
        let synced = 0;
        const targetEmail = cleanEmail || (person.email || "");
        if (targetEmail) {
          synced = await syncConversationsByEmail(targetEmail, {
            name: updated.name,
            email: cleanEmail || undefined,
            phone: cleanPhone,
          });
        }
        toast({
          title: "Profile updated",
          description: synced > 0 ? `Synced to ${synced} active conversation${synced === 1 ? "" : "s"}.` : undefined,
        });
      }
      onOpenChange(false);
    } catch (err: any) {
      console.error("Edit person failed:", err);
      toast({ title: "Update failed", description: err?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label>Full Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={32} autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label>Tags (comma-separated)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} maxLength={300} autoComplete="off" />
          </div>
          <Button type="submit" className="w-full" disabled={loading || !name.trim()}>
            {loading ? "Saving..." : "Save changes"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EditPersonDialog;
