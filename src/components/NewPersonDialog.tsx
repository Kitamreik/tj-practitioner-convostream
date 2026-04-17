import React, { useState } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { nameSchema, emailSchema, phoneSchema, tagsSchema, safeValidate } from "@/lib/validation";

const NewPersonDialog: React.FC = () => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [tags, setTags] = useState("");

  const reset = () => {
    setName("");
    setEmail("");
    setPhone("");
    setTags("");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate every field via Zod (injection-safe sanitization)
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

    setLoading(true);
    try {
      const ref = await addDoc(collection(db, "people"), {
        name: nameRes.data,
        email: cleanEmail,
        phone: cleanPhone,
        tags: tagsRes.data,
        conversations: 0,
        lastActive: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      toast({ title: "Person added", description: `${nameRes.data} saved (id: ${ref.id.slice(0, 6)}…)` });
      setOpen(false);
      reset();
    } catch (err: any) {
      console.error("Add person failed:", err);
      toast({ title: "Failed to add person", description: err?.message || "Check connection and try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Add Person</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Person</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleCreate} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label>Full Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" required maxLength={80} autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" maxLength={254} autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555-0100" maxLength={32} autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label>Tags (comma-separated)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="VIP, Enterprise" maxLength={300} autoComplete="off" />
          </div>
          <Button type="submit" className="w-full" disabled={loading || !name.trim()}>
            {loading ? "Adding..." : "Add Person"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default NewPersonDialog;
