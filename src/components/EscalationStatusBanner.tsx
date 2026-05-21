import React, { useEffect, useState } from "react";
import { collection, onSnapshot, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Clock, CheckCircle2, RotateCcw, Archive as ArchiveIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact strip showing the current user's most recent webmaster escalation
 * status (pending / approved / resolved / reopened / archived / denied).
 *
 * Renders nothing when the user has never opened an escalation. Subscribes
 * to `escalationRequests` filtered by `requesterUid` — same listener pattern
 * used in Settings → Pending escalations, kept inline so agents see status
 * updates directly above the reply composer without leaving the thread.
 */
type EscalationStatus =
  | "pending"
  | "approved"
  | "denied"
  | "resolved"
  | "reopened"
  | "archived";

interface EscalationRow {
  status: EscalationStatus;
  reason?: string;
  createdAt?: Timestamp | null;
  resolvedAt?: Timestamp | null;
  resolverEmail?: string;
}

const META: Record<
  EscalationStatus,
  { label: string; icon: React.ReactNode; tone: string }
> = {
  pending: {
    label: "Pending review",
    icon: <Clock className="h-3.5 w-3.5" />,
    tone: "border-warning/40 bg-warning/10 text-warning",
  },
  approved: {
    label: "Approved",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    tone: "border-success/40 bg-success/10 text-success",
  },
  denied: {
    label: "Denied",
    icon: <ShieldAlert className="h-3.5 w-3.5" />,
    tone: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  resolved: {
    label: "Resolved",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    tone: "border-success/40 bg-success/10 text-success",
  },
  reopened: {
    label: "Reopened",
    icon: <RotateCcw className="h-3.5 w-3.5" />,
    tone: "border-warning/40 bg-warning/10 text-warning",
  },
  archived: {
    label: "Archived",
    icon: <ArchiveIcon className="h-3.5 w-3.5" />,
    tone: "border-muted-foreground/30 bg-muted text-muted-foreground",
  },
};

const EscalationStatusBanner: React.FC<{ className?: string }> = ({ className }) => {
  const { user } = useAuth();
  const [row, setRow] = useState<EscalationRow | null>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "escalationRequests"),
      where("requesterUid", "==", user.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setRow(null);
          return;
        }
        const sorted = snap.docs
          .map((d) => d.data() as EscalationRow & { createdAt?: Timestamp })
          .sort((a, b) => {
            const am = a.createdAt?.toMillis?.() ?? 0;
            const bm = b.createdAt?.toMillis?.() ?? 0;
            return bm - am;
          });
        setRow(sorted[0] as EscalationRow);
      },
      (err) => {
        console.warn("EscalationStatusBanner listener error:", err);
        setRow(null);
      }
    );
    return unsub;
  }, [user]);

  if (!row) return null;
  const meta = META[row.status] ?? META.pending;
  const when = row.resolvedAt?.toMillis?.() ?? row.createdAt?.toMillis?.();

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border bg-card/50 px-3 py-2 text-xs",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <span className="font-medium text-foreground">Webmaster escalation:</span>
      <Badge variant="outline" className={cn("gap-1", meta.tone)}>
        {meta.icon}
        {meta.label}
      </Badge>
      {when && (
        <span className="text-muted-foreground">
          {row.status === "pending" ? "opened" : "updated"} {new Date(when).toLocaleString()}
        </span>
      )}
      {row.resolverEmail && row.status !== "pending" && (
        <span className="text-muted-foreground">by {row.resolverEmail}</span>
      )}
    </div>
  );
};

export default EscalationStatusBanner;
