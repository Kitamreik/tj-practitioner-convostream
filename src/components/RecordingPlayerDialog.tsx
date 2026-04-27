/**
 * RecordingPlayerDialog — modal preview/player for a single call recording.
 *
 * - Fetches a short-lived (15-minute) signed URL via the
 *   `getCallRecordingDownloadUrl` callable when opened.
 * - Renders a native <audio> element so the agent can preview without
 *   leaving the page (no new tab).
 * - Provides a "Download" link that opens the same signed URL in a new tab,
 *   for users who need a local copy.
 *
 * The signed URL is never persisted in Firestore — each open call mints a
 * fresh one — so even if a viewer leaves the modal open the URL expires
 * server-side after 15 minutes.
 */

import React, { useEffect, useState } from "react";
import { Loader2, Download, AlertCircle, Mic } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getCallRecordingDownloadUrl,
  type CallRecordingDoc,
} from "@/lib/callRecordings";

interface Props {
  recording: CallRecordingDoc | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const RecordingPlayerDialog: React.FC<Props> = ({ recording, open, onOpenChange }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !recording) {
      setUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCallRecordingDownloadUrl(recording.id)
      .then((u) => {
        if (cancelled) return;
        setUrl(u);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Access denied";
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, recording]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" /> Recording preview
          </DialogTitle>
          <DialogDescription>
            {recording
              ? `${recording.agentName} • ${new Date(recording.startedAt).toLocaleString()}`
              : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {recording && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="font-mono">
                {formatDuration(recording.durationMs)}
              </Badge>
              <Badge variant="outline" className="font-mono">
                {formatBytes(recording.sizeBytes)}
              </Badge>
              {recording.resolvedOnCall && (
                <Badge variant="default" className="text-[10px]">Resolved on call</Badge>
              )}
              {!recording.consentGiven && (
                <Badge variant="destructive" className="text-[10px]">No consent recorded</Badge>
              )}
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 rounded-md border border-dashed py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Generating secure link…
            </div>
          )}

          {error && !loading && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <div className="font-medium">Recording unavailable</div>
                <div className="text-xs opacity-90">{error}</div>
              </div>
            </div>
          )}

          {url && !loading && !error && (
            <audio
              key={url}
              src={url}
              controls
              autoPlay
              className="w-full"
              preload="metadata"
            />
          )}

          <p className="text-[11px] text-muted-foreground">
            This link is signed for 15 minutes. Reopen the dialog to refresh access.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={!url || loading}
            onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}
            className="gap-1"
          >
            <Download className="h-4 w-4" /> Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

function formatDuration(ms: number): string {
  if (!ms || ms < 1000) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export default RecordingPlayerDialog;
