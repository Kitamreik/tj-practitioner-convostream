/**
 * Compact button + hidden file input that lets an agent attach a PDF/DOCX
 * to the active conversation. The file is extracted, masked, summarised,
 * posted as a system message, and queued for auto-deletion within 6 hours.
 */
import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, Loader2 } from "lucide-react";
import { uploadConversationDocument } from "@/lib/conversationUploads";
import { ExtractDocError } from "@/lib/extractDocText";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  conversationId: string;
  disabled?: boolean;
}

const ACCEPT = ".pdf,.docx,.txt,.md,.csv,.json,.html,.htm,.xml,.log";

const AttachDocButton: React.FC<Props> = ({ conversationId, disabled }) => {
  const { user, profile } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onPick = () => inputRef.current?.click();

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    setBusy(true);
    try {
      const res = await uploadConversationDocument({
        conversationId,
        file,
        agent: { uid: user.uid, displayName: profile?.displayName || "Agent" },
      });
      toast({
        title: "Document attached",
        description: `Masked summary posted. Raw file auto-deletes by ${res.deleteAt.toLocaleString()}.`,
      });
    } catch (err: any) {
      const desc = err instanceof ExtractDocError ? err.message : err?.message || "Upload failed.";
      toast({ title: "Could not attach document", description: desc, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onChange} />
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={onPick}
        disabled={disabled || busy}
        title="Attach document (PDF, DOCX, TXT) — auto-masked, auto-deletes in 6h"
        aria-label="Attach document"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
      </Button>
    </>
  );
};

export default AttachDocButton;
