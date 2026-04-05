import React, { useState } from "react";
import { BookTemplate, Plus, Trash2, Mail, MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

export interface MessageTemplate {
  id: string;
  name: string;
  channel: "email" | "sms";
  subject?: string;
  body: string;
}

const defaultTemplates: MessageTemplate[] = [
  {
    id: "t1",
    name: "Welcome Email",
    channel: "email",
    subject: "Welcome to {{company}}!",
    body: "Hi {{name}},\n\nThank you for reaching out to us. We're here to help with anything you need.\n\nBest regards,\n{{agent}}",
  },
  {
    id: "t2",
    name: "Follow-up Email",
    channel: "email",
    subject: "Following up on your request",
    body: "Hi {{name}},\n\nI wanted to follow up on our previous conversation. Has the issue been resolved? Let us know if you need any further assistance.\n\nBest,\n{{agent}}",
  },
  {
    id: "t3",
    name: "Quick SMS Reply",
    channel: "sms",
    body: "Hi {{name}}, thanks for contacting us! An agent will be with you shortly.",
  },
  {
    id: "t4",
    name: "Appointment Reminder",
    channel: "sms",
    body: "Hi {{name}}, this is a reminder about your upcoming appointment. Reply YES to confirm or RESCHEDULE to change.",
  },
  {
    id: "t5",
    name: "Resolution Email",
    channel: "email",
    subject: "Your request has been resolved",
    body: "Hi {{name}},\n\nWe're happy to let you know that your issue has been resolved. If you have any other questions, feel free to reach out.\n\nThank you for your patience!\n{{agent}}",
  },
];

interface ConversationTemplatesProps {
  onInsertTemplate: (template: MessageTemplate) => void;
}

const ConversationTemplates: React.FC<ConversationTemplatesProps> = ({ onInsertTemplate }) => {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<MessageTemplate[]>(defaultTemplates);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newChannel, setNewChannel] = useState<"email" | "sms">("email");
  const [newSubject, setNewSubject] = useState("");
  const [newBody, setNewBody] = useState("");

  const handleCreate = () => {
    if (!newName.trim() || !newBody.trim()) return;
    const tpl: MessageTemplate = {
      id: `custom-${Date.now()}`,
      name: newName.trim(),
      channel: newChannel,
      subject: newChannel === "email" ? newSubject.trim() : undefined,
      body: newBody.trim(),
    };
    setTemplates((prev) => [tpl, ...prev]);
    setCreateOpen(false);
    setNewName("");
    setNewSubject("");
    setNewBody("");
    toast({ title: "Template created" });
  };

  const handleDelete = (id: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    toast({ title: "Template deleted" });
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
