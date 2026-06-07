import React, { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import WebmasterContactButtons from "@/components/WebmasterContactButtons";
import { useAuth } from "@/contexts/AuthContext";

/**
 * EscalateWebmasterModal
 *
 * Replaces the previous always-visible Call/Text shortcut row in the sidebar
 * and bottom-nav with a single "Escalate to Webmaster" button that opens a
 * focused modal. Keeps the existing WebmasterContactButtons (call + SMS
 * templates + cooldown logic) so we don't regress the underlying flow.
 *
 * Production failsafe: a free-form escalation note is auto-saved to
 * localStorage so an agent never loses context if Firestore is unreachable
 * or the page crashes mid-incident. The note is restored next time the
 * modal opens. Firestore-backed notify lives inside
 * WebmasterContactButtons (`notifyWebmasterOnContact`).
 *
 * The component is hidden for customers and for the webmaster themselves
 * (the underlying WebmasterContactButtons enforces the webmaster gate too).
 */
const DRAFT_KEY_PREFIX = "ConvoHub.webmasterEscalate.draft.";

interface Props {
  className?: string;
}

const EscalateWebmasterModal: React.FC<Props> = ({ className }) => {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  const draftKey = profile?.uid ? DRAFT_KEY_PREFIX + profile.uid : null;

  // Hydrate the draft on open so an interrupted escalation isn't lost.
  useEffect(() => {
    if (!open || !draftKey) return;
    try {
      setNote(localStorage.getItem(draftKey) ?? "");
    } catch {
      /* private mode */
    }
  }, [open, draftKey]);

  // Persist on change.
  useEffect(() => {
    if (!draftKey) return;
    try {
      if (note) localStorage.setItem(draftKey, note);
      else localStorage.removeItem(draftKey);
    } catch {
      /* private mode */
    }
  }, [note, draftKey]);

  // Customers and the webmaster themselves never see this button.
  if (!profile || profile.role === "customer" || profile.role === "webmaster") {
    return null;
  }

  const handleCopyNote = async () => {
    if (!note.trim()) return;
    try {
      await navigator.clipboard.writeText(note.trim());
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={["w-full justify-center gap-2", className].filter(Boolean).join(" ")}
          aria-label="Escalate to webmaster"
        >
          <ShieldAlert className="h-4 w-4 text-warning" />
          Escalate to Webmaster
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-warning" /> Escalate to Webmaster
          </DialogTitle>
          <DialogDescription>
            Reach the on-call webmaster directly. Your incident note is saved on this
            device so you won’t lose it if the page reloads.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="escalate-note" className="text-xs">
              Incident note (saved locally)
            </Label>
            <Textarea
              id="escalate-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What’s happening? Who’s affected? What do you need?"
              rows={4}
            />
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">
                {note ? "Draft auto-saved on this device." : "Draft will auto-save as you type."}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={!note.trim()}
                onClick={handleCopyNote}
              >
                Copy note
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="mb-2 text-xs font-medium text-foreground">Contact channels</p>
            <WebmasterContactButtons variant="full" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EscalateWebmasterModal;
