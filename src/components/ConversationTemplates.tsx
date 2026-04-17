import React, { useState, useEffect } from "react";
import { BookTemplate, Plus, Trash2, Mail, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { collection, query, orderBy, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface MessageTemplate {
  id: string;
  name: string;
  channel: "email" | "sms";
  subject?: string;
  body: string;
  /** Built-in starter templates cannot be deleted. */
  locked?: boolean;
}

const defaultTemplates: MessageTemplate[] = [
  // ---------- Email: onboarding & discovery ----------
  { id: "t1", locked: true, name: "Welcome / Intro Email", channel: "email", subject: "Welcome to {{company}}, {{name}}!", body: "Hi {{name}},\n\nThank you for reaching out to {{company}}. I'm {{agent}}, and I'll be your main point of contact.\n\nTo get started, could you share a bit about the challenges you're hoping to solve? I'll review and come back with next steps within one business day.\n\nWarm regards,\n{{agent}}" },
  { id: "t2", locked: true, name: "Discovery Call Scheduling", channel: "email", subject: "Let's schedule a discovery call", body: "Hi {{name}},\n\nThanks again for your interest in working with {{company}}. I'd love to set up a 30-minute discovery call to better understand your goals and how we can help.\n\nHere are a few times that work on my end — let me know which suits you best:\n• Tuesday 10:00 AM\n• Wednesday 2:00 PM\n• Thursday 11:30 AM\n\nIf none of these work, feel free to suggest an alternative.\n\nBest,\n{{agent}}" },
  { id: "t3", locked: true, name: "Proposal Follow-up", channel: "email", subject: "Following up on the proposal", body: "Hi {{name}},\n\nI'm following up on the proposal I sent over last week. I wanted to check whether you've had a chance to review it and if any questions came up.\n\nHappy to jump on a quick call to walk through the scope, timeline, or pricing in more detail.\n\nLooking forward to your thoughts,\n{{agent}}" },
  { id: "t4", locked: true, name: "Engagement Kickoff", channel: "email", subject: "Welcome aboard — let's kick things off", body: "Hi {{name}},\n\nWe're delighted to officially begin our engagement. Here's what to expect over the next two weeks:\n\n1. Onboarding questionnaire (sent separately)\n2. Stakeholder interviews\n3. Kickoff workshop\n\nI'll send calendar invites shortly. In the meantime, let me know who else from your team should be looped in.\n\nExcited to get started,\n{{agent}}" },

  // ---------- Email: ongoing engagement ----------
  { id: "t5", locked: true, name: "Status Update", channel: "email", subject: "Weekly status update", body: "Hi {{name}},\n\nQuick update on where things stand this week:\n\n✅ Completed: [items]\n🔄 In progress: [items]\n📅 Next week: [items]\n\nFlagging one item for your input: [decision needed]. A quick reply by Thursday would keep us on track.\n\nThanks,\n{{agent}}" },
  { id: "t6", locked: true, name: "Meeting Recap", channel: "email", subject: "Recap & next steps from today's meeting", body: "Hi {{name}},\n\nThanks for the productive conversation today. Here's a quick recap:\n\nKey decisions:\n• [decision 1]\n• [decision 2]\n\nAction items:\n• {{agent}} — [action] by [date]\n• {{name}} — [action] by [date]\n\nLet me know if I missed or misrepresented anything.\n\nBest,\n{{agent}}" },
  { id: "t7", locked: true, name: "Information Request", channel: "email", subject: "Quick request for information", body: "Hi {{name}},\n\nTo keep things moving, could you send over the following at your convenience?\n\n• [item 1]\n• [item 2]\n• [item 3]\n\nNo rush — end of week works great. Let me know if anything is unclear or if you'd like to walk through it on a call.\n\nThanks,\n{{agent}}" },
  { id: "t8", locked: true, name: "Invoice / Billing Notice", channel: "email", subject: "Invoice for {{company}} services", body: "Hi {{name}},\n\nPlease find attached invoice [#####] for services rendered this period. Payment terms are net 30, due [date].\n\nLet me know if you have any questions about the line items or need a different format for your records.\n\nThank you for your continued trust in {{company}}.\n\nBest,\n{{agent}}" },

  // ---------- Email: resolution & retention ----------
  { id: "t9", locked: true, name: "Issue Resolution", channel: "email", subject: "Your request has been resolved", body: "Hi {{name}},\n\nGood news — the issue you raised has been resolved. Here's a brief summary of what we did:\n\n• [action taken]\n• [outcome]\n\nIf you notice anything else or have follow-up questions, just reply to this thread. Thank you for your patience throughout.\n\nBest,\n{{agent}}" },
  { id: "t10", locked: true, name: "Engagement Wrap-up", channel: "email", subject: "Wrapping up our engagement", body: "Hi {{name}},\n\nAs we wrap up this phase of work, I wanted to thank you and your team for the partnership. A short summary of what we delivered:\n\n• [deliverable 1]\n• [deliverable 2]\n• [deliverable 3]\n\nI'll send a brief feedback survey separately — your honest input helps us improve. And of course, the door is always open for future work.\n\nWith gratitude,\n{{agent}}" },
  { id: "t11", locked: true, name: "Referral Request", channel: "email", subject: "A small favor", body: "Hi {{name}},\n\nIt's been a pleasure working with you. If you know anyone else who could benefit from what {{company}} offers, I'd be grateful for an introduction — referrals from clients like you mean everything.\n\nNo pressure at all, and thank you again for your trust.\n\nBest,\n{{agent}}" },

  // ---------- SMS templates ----------
  { id: "t12", locked: true, name: "Quick Acknowledgement", channel: "sms", body: "Hi {{name}}, this is {{agent}} from {{company}}. Got your message — I'll have a full response within the next few hours. Thanks!" },
  { id: "t13", locked: true, name: "Appointment Reminder", channel: "sms", body: "Hi {{name}}, friendly reminder of your call with {{agent}} tomorrow. Reply YES to confirm or RESCHEDULE to pick a new time." },
  { id: "t14", locked: true, name: "Meeting Confirmation", channel: "sms", body: "Hi {{name}}, confirming our meeting today. I'll send the call link 10 minutes beforehand. See you soon — {{agent}}" },
  { id: "t15", locked: true, name: "Running Late", channel: "sms", body: "Hi {{name}}, {{agent}} here — running about 5 minutes late to our call. Apologies and thanks for your patience." },
  { id: "t16", locked: true, name: "Document Sent Notice", channel: "sms", body: "Hi {{name}}, I just emailed over the document we discussed. Let me know once you've had a chance to review. — {{agent}}" },
  { id: "t17", locked: true, name: "Payment Reminder", channel: "sms", body: "Hi {{name}}, a friendly reminder that invoice [#####] is due in 3 days. Reply if you need a copy resent. Thanks — {{company}}" },
  { id: "t18", locked: true, name: "Thank You / Check-in", channel: "sms", body: "Hi {{name}}, just checking in after our recent work together. Anything we can help with? Always glad to hear from you. — {{agent}}" },
];

interface ConversationTemplatesProps {
  onInsertTemplate: (template: MessageTemplate) => void;
}

const ConversationTemplates: React.FC<ConversationTemplatesProps> = ({ onInsertTemplate }) => {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<MessageTemplate[]>(defaultTemplates);
  const [usingFallback, setUsingFallback] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newChannel, setNewChannel] = useState<"email" | "sms">("email");
  const [newSubject, setNewSubject] = useState("");
  const [newBody, setNewBody] = useState("");

  // Listen to Firestore templates collection
  useEffect(() => {
    const q = query(collection(db, "templates"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        if (snapshot.empty) {
          setTemplates(defaultTemplates);
          setUsingFallback(true);
        } else {
          setTemplates(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as MessageTemplate)));
          setUsingFallback(false);
        }
      },
      (error) => {
        console.error("Templates listener error:", error);
        setTemplates(defaultTemplates);
        setUsingFallback(true);
      }
    );
    return unsub;
  }, []);

  const handleCreate = async () => {
    if (!newName.trim() || !newBody.trim()) return;
    const tplData = {
      name: newName.trim(),
      channel: newChannel,
      subject: newChannel === "email" ? newSubject.trim() : null,
      body: newBody.trim(),
      createdAt: serverTimestamp(),
    };
    try {
      await addDoc(collection(db, "templates"), tplData);
      toast({ title: "Template created" });
    } catch (e) {
      console.error("Failed to create template:", e);
      // Fallback: add locally
      setTemplates((prev) => [{ id: `local-${Date.now()}`, ...tplData, subject: tplData.subject || undefined } as MessageTemplate, ...prev]);
      toast({ title: "Template created locally" });
    }
    setCreateOpen(false);
    setNewName("");
    setNewSubject("");
    setNewBody("");
  };

  const handleDelete = async (id: string) => {
    const tpl = templates.find((t) => t.id === id);
    if (tpl?.locked) {
      toast({ title: "Starter template", description: "Built-in templates cannot be deleted.", variant: "destructive" });
      return;
    }
    if (usingFallback || id.startsWith("local-")) {
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      toast({ title: "Template deleted" });
      return;
    }
    try {
      await deleteDoc(doc(db, "templates", id));
      toast({ title: "Template deleted" });
    } catch (e) {
      console.error("Failed to delete template:", e);
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const emailTemplates = templates.filter((t) => t.channel === "email");
  const smsTemplates = templates.filter((t) => t.channel === "sms");

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <BookTemplate className="h-3.5 w-3.5" />
          Templates
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[380px] sm:w-[420px] p-0 flex flex-col">
        <SheetHeader className="p-6 pb-4 border-b border-border">
          <SheetTitle className="flex items-center justify-between">
            <span>Message Templates</span>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="default" className="gap-1">
                  <Plus className="h-3.5 w-3.5" /> New
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Template</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-2">
                  <div className="space-y-2">
                    <Label>Template Name</Label>
                    <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Welcome Email" />
                  </div>
                  <div className="space-y-2">
                    <Label>Channel</Label>
                    <Select value={newChannel} onValueChange={(v) => setNewChannel(v as "email" | "sms")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="sms">SMS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {newChannel === "email" && (
                    <div className="space-y-2">
                      <Label>Subject Line</Label>
                      <Input value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="Subject..." />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Message Body</Label>
                    <Textarea value={newBody} onChange={(e) => setNewBody(e.target.value)} placeholder="Use {{name}}, {{agent}}, {{company}} as variables..." rows={5} />
                  </div>
                  <p className="text-xs text-muted-foreground">Variables: {"{{name}}"}, {"{{agent}}"}, {"{{company}}"}</p>
                  <Button className="w-full" onClick={handleCreate} disabled={!newName.trim() || !newBody.trim()}>
                    Create Template
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1 p-4">
          {emailTemplates.length > 0 && (
            <div className="mb-6">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" /> Email Templates
              </h4>
              <div className="space-y-2">
                {emailTemplates.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => onInsertTemplate(tpl)}
                    className="w-full text-left rounded-lg border border-border p-3 hover:bg-accent/50 transition-colors group"
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{tpl.name}</p>
                        {tpl.subject && <p className="text-xs text-muted-foreground mt-0.5">Subject: {tpl.subject}</p>}
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{tpl.body}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-destructive"
                        onClick={(e) => { e.stopPropagation(); handleDelete(tpl.id); }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {smsTemplates.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" /> SMS Templates
              </h4>
              <div className="space-y-2">
                {smsTemplates.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => onInsertTemplate(tpl)}
                    className="w-full text-left rounded-lg border border-border p-3 hover:bg-accent/50 transition-colors group"
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{tpl.name}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{tpl.body}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-destructive"
                        onClick={(e) => { e.stopPropagation(); handleDelete(tpl.id); }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};

export default ConversationTemplates;
