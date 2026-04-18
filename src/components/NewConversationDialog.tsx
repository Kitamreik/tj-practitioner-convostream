import React, { useRef, useState } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Paperclip, FileText, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { extractDocText, ExtractDocError } from "@/lib/extractDocText";
import { useAuth } from "@/contexts/AuthContext";

const NewConversationDialog: React.FC = () => {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // Default to "mobile" so entries created directly from the conversation
  // page are tagged as in-app captures (the running-feet icon makes them
  // easy to spot in the list).
  const [channel, setChannel] = useState<string>("mobile");
  const [message, setMessage] = useState("");
  const [attachedDocName, setAttachedDocName] = useState<string | null>(null);
  const [attachedDocTruncated, setAttachedDocTruncated] = useState(false);
  const [extractText, setExtractText] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setName("");
    setEmail("");
    setPhone("");
    setMessage("");
    setChannel("mobile");
    setAttachedDocName(null);
    setAttachedDocTruncated(false);
    setExtractText(null);
  };

  /**
   * Extract text from an uploaded document. We store the extract on its OWN
   * Firestore field (`extractText`) instead of inlining it in the message
   * body, so the bubble preview stays clean and the detail view can render
   * a tidy collapsible "View original extract" section.
   */
  const handleFile = async (file: File | null) => {
    if (!file) return;
    setExtracting(true);
    try {
      const result = await extractDocText(file);
      setExtractText(result.text);
      setAttachedDocName(result.sourceName);
      setAttachedDocTruncated(result.truncated);
      // Seed the message body with a short preview only if it's empty,
      // so the agent has something to send without re-typing — but the
      // full extract is what gets persisted to the dedicated field.
      setMessage((prev) => {
        if (prev.trim()) return prev;
        const firstLine = result.text.split(/\n+/).find((l) => l.trim()) ?? "";
        return firstLine.slice(0, 240);
      });
      toast({
        title: "Document attached",
        description: result.truncated
          ? `${result.sourceName} extracted (truncated to 4 000 chars).`
          : `${result.sourceName} extracted.`,
      });
    } catch (err) {
      const msg =
        err instanceof ExtractDocError ? err.message : "Could not read this file.";
      toast({ title: "Could not extract text", description: msg, variant: "destructive" });
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const clearAttachment = () => {
    setAttachedDocName(null);
    setAttachedDocTruncated(false);
    setExtractText(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !message.trim()) return;
    setLoading(true);
    try {
      const convoRef = await addDoc(collection(db, "conversations"), {
        customerName: name.trim(),
        customerEmail: email.trim(),
        customerPhone: phone.trim() || null,
        lastMessage: message.trim().split(/\n+/)[0].slice(0, 240),
        channel,
        timestamp: serverTimestamp(),
        unread: true,
        status: "active",
        // Track entries made directly from the conversation page so audit
        // logs and analytics can distinguish in-app captures from inbound
        // webhook traffic (Slack/Twilio/Gmail). The icon/key page reads
        // `source` to render the running-feet badge for "mobile" entries.
        source: "conversation-page",
        createdAt: serverTimestamp(),
        createdByUid: profile?.uid ?? null,
        createdByName: profile?.displayName ?? profile?.email ?? null,
        ...(attachedDocName
          ? { sourceDocName: attachedDocName, sourceDocTruncated: attachedDocTruncated }
          : {}),
      });
      await addDoc(collection(db, "conversations", convoRef.id, "messages"), {
        conversationId: convoRef.id,
        sender: "customer",
        text: message.trim(),
        timestamp: serverTimestamp(),
        channel,
        ...(attachedDocName && extractText
          ? {
              sourceDocName: attachedDocName,
              sourceDocTruncated: attachedDocTruncated,
              extractText,
            }
          : {}),
      });
      toast({
        title: "Conversation created",
        description: attachedDocName
          ? `Seeded from ${attachedDocName}.`
          : undefined,
      });
      setOpen(false);
      reset();
    } catch (err: any) {
      toast({ title: "Failed to create conversation", description: err?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 w-8 p-0">
          <Plus className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Conversation</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleCreate} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label>Customer Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" required />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@example.com" />
          </div>
          <div className="space-y-2">
            <Label>Phone Number</Label>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+15551234567" />
          </div>
          <div className="space-y-2">
            <Label>Channel</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mobile">Mobile (in-app capture)</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="phone">Phone</SelectItem>
                <SelectItem value="slack">Slack</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Initial Message</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.csv,.json,.log,.html,.htm,.xml,.pdf,.docx,text/plain,text/csv,text/html,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                disabled={extracting}
                onClick={() => fileInputRef.current?.click()}
              >
                {extracting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Paperclip className="h-3.5 w-3.5" />
                )}
                {extracting ? "Reading…" : "Attach document"}
              </Button>
            </div>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="How can we help? Or attach a document to seed the message."
              required
              rows={5}
              className="resize-y"
            />
            {attachedDocName && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground truncate">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{attachedDocName}</span>
                  {attachedDocTruncated && (
                    <span className="text-warning">· truncated</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={clearAttachment}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Remove attached document reference"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Supported uploads: .txt, .md, .csv, .json, .html, .pdf, .docx (max 2MB). Only
              extracted text is saved — the file itself is not uploaded.
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={loading || extracting}>
            {loading ? "Creating..." : "Create Conversation"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default NewConversationDialog;
