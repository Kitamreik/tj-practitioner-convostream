/**
 * CallRecorder — agent-facing widget for capturing browser-audio call
 * recordings tied to a conversation. Renders consent banner → mic capture →
 * elapsed timer → upload to Firebase Storage + metadata to Firestore.
 *
 * Designed to live inside the Conversations detail header.
 */

import React, { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  startRecording,
  uploadRecording,
  subscribeRetentionPolicy,
  type RecorderHandle,
  type RetentionPolicy,
  DEFAULT_RETENTION,
} from "@/lib/callRecordings";

interface Props {
  conversationId: string;
  conversationStartedAt?: number;
  conversationStatus?: "active" | "waiting" | "resolved";
  className?: string;
}

const CallRecorder: React.FC<Props> = ({
  conversationId,
  conversationStartedAt,
  conversationStatus,
  className,
}) => {
  const { profile } = useAuth();
  const [policy, setPolicy] = useState<RetentionPolicy>(DEFAULT_RETENTION);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showConsent, setShowConsent] = useState(false);
  const handleRef = useRef<RecorderHandle | null>(null);
  const tickerRef = useRef<number | null>(null);

  useEffect(() => subscribeRetentionPolicy(setPolicy), []);

  // Elapsed timer
  useEffect(() => {
    if (!recording) {
      if (tickerRef.current) window.clearInterval(tickerRef.current);
      tickerRef.current = null;
      return;
    }
    const start = handleRef.current?.getStartedAt() ?? Date.now();
    tickerRef.current = window.setInterval(() => {
      setElapsed(Date.now() - start);
    }, 250);
    return () => {
      if (tickerRef.current) window.clearInterval(tickerRef.current);
    };
  }, [recording]);

  const onClickStart = () => {
    if (policy.requireConsent) {
      setShowConsent(true);
    } else {
      void beginRecording();
    }
  };

  const beginRecording = async () => {
    try {
      const h = await startRecording();
      handleRef.current = h;
      setRecording(true);
      setElapsed(0);
      toast({ title: "Recording started", description: "Click Stop when the call ends." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Microphone unavailable";
      toast({ title: "Could not start recording", description: msg, variant: "destructive" });
    }
  };

  const onStop = async () => {
    if (!handleRef.current || !profile) return;
    setUploading(true);
    try {
      const blob = await handleRef.current.stop();
      const startedAt = handleRef.current.getStartedAt();
      const endedAt = Date.now();
      handleRef.current = null;
      setRecording(false);
      await uploadRecording({
        conversationId,
        agentUid: profile.uid,
        agentName: profile.displayName,
        blob,
        startedAt,
        endedAt,
        consentGiven: policy.requireConsent,
        conversationStartedAt,
        resolvedOnCall: conversationStatus === "resolved",
        resolvedAt: conversationStatus === "resolved" ? endedAt : undefined,
      });
      toast({
        title: "Recording saved",
        description: `${formatDuration(endedAt - startedAt)} uploaded for compliance.`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast({ title: "Recording save failed", description: msg, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  if (!profile) return null;

  return (
    <div className={className}>
      {recording ? (
        <Button
          variant="destructive"
          size="sm"
          onClick={onStop}
          disabled={uploading}
          className="gap-2"
          aria-label="Stop recording"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
          <span className="hidden sm:inline">Stop</span>
          <span className="font-mono text-xs">{formatDuration(elapsed)}</span>
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={onClickStart}
          disabled={uploading}
          className="gap-2"
          aria-label="Start call recording"
          title="Record this call (with consent) for compliance"
        >
          <Mic className="h-4 w-4" />
          <span className="hidden sm:inline">Record</span>
        </Button>
      )}

      <AlertDialog open={showConsent} onOpenChange={setShowConsent}>
        <AlertDialogContent className="max-w-[min(28rem,calc(100vw-1rem))]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Confirm recording consent
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-left">
              <span className="block">{policy.consentText}</span>
              <span className="block rounded-md border bg-muted/50 p-2 text-xs">
                <strong className="text-foreground">Retention:</strong>{" "}
                {policy.retentionDays > 0
                  ? `Recordings are automatically deleted after ${policy.retentionDays} day${policy.retentionDays === 1 ? "" : "s"}.`
                  : "No automatic retention — recordings are kept indefinitely."}
              </span>
              <span className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Make sure the customer has been informed and consented before starting the recording.
                </span>
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void beginRecording()}>
              Consent received — start
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default CallRecorder;
