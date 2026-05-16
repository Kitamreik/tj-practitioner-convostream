import React, { useState } from "react";
import { Mail, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * SupportEmailDialog — lets any user compose a message to support@convohub.dev
 * by choosing from a curated template, customizing subject + body, then
 * opening their default mail client via mailto:. We always append a clear
 * monitoring + escalation notice so the user knows misuse is reviewed.
 *
 * No backend calls — purely a composer. Pairs nicely with future Cloud
 * Function delivery if/when SMTP is wired up.
 */

const SUPPORT_ADDRESS = "support@convohub.dev";

const MONITORING_NOTICE =
  "\n\n— Please note: all communications with ConvoHub support are monitored " +
  "for quality, training, and safety purposes. Abuse, harassment, or other " +
  "misuse will result in escalation protocols enforced by our agents.";

interface SupportTemplate {
  id: string;
  label: string;
  subject: string;
  body: string;
}

const TEMPLATES: SupportTemplate[] = [
  {
    id: "billing",
    label: "Billing question",
    subject: "Billing question — account [your account name]",
    body:
      "Hi ConvoHub team,\n\nI have a question about a recent charge / invoice on my account.\n\nDetails:\n- Account / workspace: \n- Date of charge: \n- Amount: \n- What I'm asking about: \n\nThanks!",
  },
  {
    id: "bug",
    label: "Report a bug",
    subject: "Bug report — [short description]",
    body:
      "Hi ConvoHub team,\n\nI ran into a problem and wanted to report it.\n\nWhat I was doing: \nWhat I expected: \nWhat actually happened: \nBrowser / device: \nScreenshot (optional): \n\nThanks!",
  },
  {
    id: "feature",
    label: "Feature request",
    subject: "Feature request — [short title]",
    body:
      "Hi ConvoHub team,\n\nI'd love to see the following feature added:\n\nWhat I want to do: \nWhy it would help: \nAny workarounds I've tried: \n\nThanks!",
  },
  {
    id: "account",
    label: "Account access issue",
    subject: "Account access issue",
    body:
      "Hi ConvoHub team,\n\nI'm having trouble accessing my account.\n\nEmail on the account: \nWhat happens when I try to sign in: \nWhen it started: \n\nThanks!",
  },
  {
    id: "abuse",
    label: "Report abuse / safety concern",
    subject: "Safety report",
    body:
      "Hi ConvoHub team,\n\nI'd like to report a safety or abuse concern.\n\nWhat happened: \nWho was involved: \nWhen: \nAny relevant links or message IDs: \n\nThanks for looking into this.",
  },
  {
    id: "blank",
    label: "Other — start blank",
    subject: "",
    body: "Hi ConvoHub team,\n\n",
  },
];

interface Props {
  trigger?: React.ReactNode;
}

const SupportEmailDialog: React.FC<Props> = ({ trigger }) => {
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string>(TEMPLATES[0].id);
  const tpl = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
  const [subject, setSubject] = useState(tpl.subject);
  const [body, setBody] = useState(tpl.body);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const next = TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
    setSubject(next.subject);
    setBody(next.body);
  };

  const openMail = () => {
    const finalBody = `${body}${MONITORING_NOTICE}`;
    const href = `mailto:${SUPPORT_ADDRESS}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(finalBody)}`;
    window.location.href = href;
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm" className="gap-1.5">
            <Mail className="h-3.5 w-3.5" /> Email support
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            Email ConvoHub support
          </DialogTitle>
          <DialogDescription>
            Pick a template, edit as needed, and we'll open your mail client
            addressed to {SUPPORT_ADDRESS}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Template</Label>
            <Select value={templateId} onValueChange={applyTemplate}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATES.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What's this about?"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Message</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="mt-1 min-h-[180px] font-mono text-xs"
            />
          </div>
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
            <ShieldAlert className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p>
              All communications with ConvoHub support are <strong>monitored</strong>{" "}
              for quality, training, and safety. Abuse or misuse will result in
              escalation protocols enforced by our agents. This notice is
              appended automatically to your message.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={openMail} className="gap-2">
            <Mail className="h-4 w-4" /> Open in mail
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SupportEmailDialog;
