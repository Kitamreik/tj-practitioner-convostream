/**
 * Settings panel: pending signup approvals + signup-investigation queue.
 *
 * Webmasters and admins can:
 *   - See every account with approvalStatus === "pending"
 *   - Approve (unlocks the platform) or reject (with optional note)
 *   - Reject + push the form data + a screenshot of the user card into the
 *     `investigationRequests` queue for follow-up.
 *
 * Falls back to a localStorage cache when Firestore writes are denied.
 */
import React, { useEffect, useRef, useState } from "react";
import { ShieldCheck, Check, X, AlertTriangle, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  approveSignup,
  createSignupInvestigation,
  listLocalInvestigations,
  rejectSignup,
  subscribePendingSignups,
  subscribeSignupInvestigations,
  type InvestigationRequest,
  type PendingSignup,
} from "@/lib/signupApproval";
import { captureElementAsDataUrl } from "@/lib/screenshot";
import { verifyAgainstRoster, subscribeAgentRoster, type RosterEntry } from "@/lib/agentRoster";

const SignupApprovalsPanel: React.FC = () => {
  const { profile } = useAuth();
  const canReview = profile?.role === "webmaster" || profile?.role === "admin";
  const [pending, setPending] = useState<PendingSignup[]>([]);
  const [investigations, setInvestigations] = useState<InvestigationRequest[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [rejectionNote, setRejectionNote] = useState<Record<string, string>>({});
  const cardRefs = useRef<Record<string, HTMLLIElement | null>>({});

  useEffect(() => {
    if (!canReview) return;
    const unsubA = subscribePendingSignups(setPending);
    const unsubB = subscribeSignupInvestigations(setInvestigations);
    const unsubC = subscribeAgentRoster(setRoster);
    return () => {
      unsubA();
      unsubB();
      unsubC();
    };
  }, [canReview]);

  if (!canReview) return null;

  const handleApprove = async (row: PendingSignup) => {
    if (!profile) return;
    setBusyUid(row.uid);
    try {
      await approveSignup(row.uid, profile.uid);
      toast({
        title: "Account approved",
        description: `${row.displayName} can now access the platform.`,
      });
    } catch (e) {
      toast({
        title: "Could not approve",
        description: (e as Error)?.message,
        variant: "destructive",
      });
    } finally {
      setBusyUid(null);
    }
  };

  const handleReject = async (row: PendingSignup) => {
    if (!profile) return;
    const note = (rejectionNote[row.uid] ?? "").trim();
    setBusyUid(row.uid);
    try {
      // Capture the row card as a screenshot before mutating state.
      const card = cardRefs.current[row.uid];
      const screenshot = card ? await captureElementAsDataUrl(card) : null;
      // Push to investigation queue (with local fallback).
      const inv = await createSignupInvestigation({
        reason: note || "Signup rejected by reviewer.",
        requesterUid: profile.uid,
        requesterEmail: profile.email,
        targetEmail: row.email,
        targetDisplayName: row.displayName,
        screenshotDataUrl: screenshot,
      });
      // Mark profile rejected.
      await rejectSignup(row.uid, profile.uid, note);
      toast({
        title: "Signup rejected",
        description: inv.ok
          ? "Pushed to the investigation queue."
          : "Saved to local fallback — Firestore write was denied.",
        variant: inv.ok ? undefined : "destructive",
      });
    } catch (e) {
      toast({
        title: "Could not reject",
        description: (e as Error)?.message,
        variant: "destructive",
      });
    } finally {
      setBusyUid(null);
    }
  };

  const localFallbackCount = listLocalInvestigations().length;

  return (
    <div id="signup-approvals" className="rounded-xl border border-border bg-card p-4 sm:p-6">
      <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold text-card-foreground">
        <ShieldCheck className="h-5 w-5 text-primary" />
        Pending signup approvals
        <Badge variant="secondary" className="ml-1">{pending.length}</Badge>
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Every new signup is gated until a webmaster or admin verifies their identity against the{" "}
        <a href="#agent-roster" className="underline hover:text-foreground">agent roster</a>.
      </p>

      {pending.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No pending signups.
        </div>
      ) : (
        <ul className="space-y-3">
          {pending.map((row) => {
            const match = verifyAgainstRoster(
              { displayName: row.displayName, email: row.email },
              roster
            );
            return (
              <li
                key={row.uid}
                ref={(el) => {
                  cardRefs.current[row.uid] = el;
                }}
                className="rounded-lg border border-border bg-background p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground truncate">
                        {row.displayName}
                      </span>
                      {match.matched ? (
                        <Badge variant="default" className="gap-1 text-[10px]">
                          <Check className="h-3 w-3" />
                          Roster match · {match.matchedOn}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" />
                          No roster match
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{row.email}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="gap-1"
                      disabled={busyUid === row.uid}
                      onClick={() => handleApprove(row)}
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      disabled={busyUid === row.uid}
                      onClick={() => handleReject(row)}
                    >
                      <X className="h-3.5 w-3.5" /> Reject + investigate
                    </Button>
                  </div>
                </div>
                <Textarea
                  className="mt-2 text-xs"
                  placeholder="Optional rejection note / context for the investigation request"
                  value={rejectionNote[row.uid] ?? ""}
                  onChange={(e) =>
                    setRejectionNote((s) => ({ ...s, [row.uid]: e.target.value }))
                  }
                  rows={2}
                />
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6 border-t border-border pt-4">
        <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileSearch className="h-4 w-4 text-primary" />
          Investigation queue
          <Badge variant="secondary">{investigations.length}</Badge>
          {localFallbackCount > 0 && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">
              {localFallbackCount} local fallback
            </Badge>
          )}
        </h4>
        {investigations.length === 0 ? (
          <p className="text-xs text-muted-foreground">No open investigation requests.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {investigations.slice(0, 10).map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <Badge variant={inv.status === "open" ? "default" : "secondary"}>
                  {inv.status}
                </Badge>
                <span className="font-medium text-foreground truncate">
                  {inv.targetDisplayName}
                </span>
                <span className="text-muted-foreground truncate">{inv.targetEmail}</span>
                <span className="ml-auto text-muted-foreground">
                  {inv.createdAt?.toDate ? inv.createdAt.toDate().toLocaleString() : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default SignupApprovalsPanel;
