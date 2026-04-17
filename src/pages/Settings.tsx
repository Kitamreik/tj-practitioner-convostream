import React, { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Moon,
  Sun,
  User,
  Shield,
  KeyRound,
  Send,
  CheckCircle2,
  Clock,
  Users,
  Inbox,
  Trash2,
  Check,
  X,
  ShieldOff,
  Search,
  ExternalLink,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { httpsCallable } from "firebase/functions";
import { functions, db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";

const ESCALATION_NOTIFY_EMAIL = "kit.tjclasses@gmail.com";

interface PendingEscalation {
  id: string;
  requesterUid: string;
  requesterEmail: string | null;
  requesterName: string | null;
  requesterRole: string;
  reason: string;
  emailSent: boolean;
  createdAt: any;
}

interface AccountRow {
  uid: string;
  email: string;
  displayName: string;
  role: "admin" | "webmaster";
  escalatedAccess?: boolean;
  createdAt?: any;
}

interface InvestigationRow {
  id: string;
  conversationId: string;
  customerName: string;
  reason: string;
  requesterUid: string;
  requesterEmail: string | null;
  requesterName: string | null;
  status: string;
  emailSent: boolean;
  createdAt: any;
  resolvedAt?: any;
  resolutionNote?: string;
}

const SettingsPage: React.FC = () => {
  const { user, profile } = useAuth();
  const { theme, toggleTheme } = useTheme();

  // ---- Promote (webmaster only) ----
  const [promoteEmail, setPromoteEmail] = useState("");
  const [promoting, setPromoting] = useState(false);

  const handlePromote = async () => {
    const email = promoteEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      toast({ title: "Enter a valid email", variant: "destructive" });
      return;
    }
    setPromoting(true);
    try {
      const fn = httpsCallable<{ targetEmail: string; role: "webmaster" }, { ok: boolean; previousRole: string; newRole: string }>(
        functions,
        "promoteToWebmaster"
      );
      const res = await fn({ targetEmail: email, role: "webmaster" });
      toast({
        title: "Role granted",
        description: `${email} promoted ${res.data.previousRole} → ${res.data.newRole}.`,
      });
      setPromoteEmail("");
    } catch (e: any) {
      toast({
        title: "Promotion failed",
        description: e?.message || "Unable to grant role.",
        variant: "destructive",
      });
    } finally {
      setPromoting(false);
    }
  };

  // ---- Escalate (admin only) ----
  const [reason, setReason] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [latestRequest, setLatestRequest] = useState<{
    status: string;
    emailSent: boolean;
    createdAt: any;
  } | null>(null);

  // Subscribe to the user's most recent escalation request so they see status updates.
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "escalationRequests"),
      where("requesterUid", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(1)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setLatestRequest(null);
          return;
        }
        const d = snap.docs[0].data() as any;
        setLatestRequest({
          status: d.status || "pending",
          emailSent: !!d.emailSent,
          createdAt: d.createdAt,
        });
      },
      () => setLatestRequest(null)
    );
    return unsub;
  }, [user]);

  const handleEscalate = async () => {
    setRequesting(true);
    try {
      const fn = httpsCallable<{ reason: string }, { ok: boolean; emailSent: boolean; emailError: string | null }>(
        functions,
        "requestWebmasterEscalation"
      );
      const res = await fn({ reason });
      if (res.data.emailSent) {
        toast({
          title: "Escalation requested",
          description: `Email sent to ${ESCALATION_NOTIFY_EMAIL}. A webmaster will review shortly.`,
        });
      } else {
        toast({
          title: "Request recorded",
          description: `Email delivery is not configured yet, but your request was logged for the webmaster.`,
        });
      }
      setReason("");
    } catch (e: any) {
      toast({
        title: "Could not submit request",
        description: e?.message || "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setRequesting(false);
    }
  };

  const isWebmaster = profile?.role === "webmaster";
  const hasEscalatedAccess = profile?.escalatedAccess === true;

  // ---- Pending escalation requests (webmaster only) ----
  const [pending, setPending] = useState<PendingEscalation[]>([]);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isWebmaster) return;
    const q = query(
      collection(db, "escalationRequests"),
      where("status", "==", "pending"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: PendingEscalation[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            requesterUid: data.requesterUid,
            requesterEmail: data.requesterEmail ?? null,
            requesterName: data.requesterName ?? null,
            requesterRole: data.requesterRole ?? "admin",
            reason: data.reason ?? "",
            emailSent: !!data.emailSent,
            createdAt: data.createdAt,
          };
        });
        setPending(rows);
      },
      (err) => {
        console.warn("Pending escalations listener error:", err);
        setPending([]);
      }
    );
    return unsub;
  }, [isWebmaster]);

  const decide = async (requestId: string, decision: "approve" | "deny") => {
    setDecidingId(requestId);
    try {
      const fn = httpsCallable<{ requestId: string; decision: "approve" | "deny" }, { ok: boolean; status: string }>(
        functions,
        "decideEscalationRequest"
      );
      const res = await fn({ requestId, decision });
      toast({
        title: decision === "approve" ? "Request approved" : "Request denied",
        description:
          decision === "approve"
            ? "User now has escalated access to Integrations, Analytics, and Gmail API."
            : `Request ${res.data.status}.`,
      });
    } catch (e: any) {
      toast({ title: "Could not update request", description: e?.message, variant: "destructive" });
    } finally {
      setDecidingId(null);
    }
  };

  // ---- All accounts (webmaster only) ----
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);

  useEffect(() => {
    if (!isWebmaster) return;
    const unsub = onSnapshot(
      query(collection(db, "users"), orderBy("createdAt", "desc")),
      (snap) => {
        const rows: AccountRow[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            uid: d.id,
            email: data.email ?? "",
            displayName: data.displayName ?? "",
            role: data.role ?? "admin",
            escalatedAccess: !!data.escalatedAccess,
            createdAt: data.createdAt,
          };
        });
        setAccounts(rows);
      },
      (err) => {
        console.warn("Accounts listener error:", err);
        setAccounts([]);
      }
    );
    return unsub;
  }, [isWebmaster]);

  const deleteAccount = async (uid: string, email: string) => {
    setDeletingUid(uid);
    try {
      const fn = httpsCallable<{ targetUid: string }, { ok: boolean }>(functions, "deleteUserAccount");
      await fn({ targetUid: uid });
      toast({ title: "Account deleted", description: `${email || uid} removed from Auth + Firestore.` });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    } finally {
      setDeletingUid(null);
    }
  };

  // ---- Revoke escalated access (webmaster only) ----
  const [revokingUid, setRevokingUid] = useState<string | null>(null);
  const revokeEscalation = async (uid: string, email: string) => {
    setRevokingUid(uid);
    try {
      const fn = httpsCallable<{ targetUid: string }, { ok: boolean }>(functions, "revokeEscalatedAccess");
      await fn({ targetUid: uid });
      toast({ title: "Escalated access revoked", description: `${email || uid} no longer has expanded access.` });
    } catch (e: any) {
      toast({ title: "Revoke failed", description: e?.message, variant: "destructive" });
    } finally {
      setRevokingUid(null);
    }
  };

  // ---- Investigation requests (webmaster only) ----
  const [investigations, setInvestigations] = useState<InvestigationRow[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isWebmaster) return;
    const unsub = onSnapshot(
      query(collection(db, "investigationRequests"), orderBy("createdAt", "desc"), limit(50)),
      (snap) => {
        const rows: InvestigationRow[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            conversationId: data.conversationId ?? "",
            customerName: data.customerName ?? "",
            reason: data.reason ?? "",
            requesterUid: data.requesterUid ?? "",
            requesterEmail: data.requesterEmail ?? null,
            requesterName: data.requesterName ?? null,
            status: data.status ?? "open",
            emailSent: !!data.emailSent,
            createdAt: data.createdAt,
            resolvedAt: data.resolvedAt,
            resolutionNote: data.resolutionNote,
          };
        });
        setInvestigations(rows);
      },
      (err) => {
        console.warn("Investigation requests listener error:", err);
        setInvestigations([]);
      }
    );
    return unsub;
  }, [isWebmaster]);

  const resolveInvestigation = async (id: string) => {
    setResolvingId(id);
    try {
      const fn = httpsCallable<{ requestId: string }, { ok: boolean }>(functions, "resolveInvestigationRequest");
      await fn({ requestId: id });
      toast({ title: "Investigation resolved" });
    } catch (e: any) {
      toast({ title: "Could not resolve", description: e?.message, variant: "destructive" });
    } finally {
      setResolvingId(null);
    }
  };

  const visibleInvestigations = showResolved
    ? investigations
    : investigations.filter((i) => i.status !== "resolved");

  const formatTime = (ts: any) => {
    try {
      if (ts?.toDate) return ts.toDate().toLocaleString();
    } catch { /* noop */ }
    return "—";
  };

  return (
    <div className={`p-4 md:p-8 mx-auto ${isWebmaster ? "max-w-4xl" : "max-w-2xl"}`}>
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and preferences</p>
      </div>

      <div className="space-y-6 md:space-y-8">
        {/* Profile */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-4">
            <User className="h-5 w-5 text-primary" />
            Profile
          </h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input value={profile?.displayName || ""} readOnly className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={profile?.email || ""} readOnly className="bg-muted" />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Label>Role</Label>
              <Badge variant="secondary" className="capitalize">{profile?.role}</Badge>
              {hasEscalatedAccess && !isWebmaster && (
                <Badge variant="outline" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Escalated access
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-4">
            {theme === "light" ? <Sun className="h-5 w-5 text-primary" /> : <Moon className="h-5 w-5 text-primary" />}
            Appearance
          </h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Theme</p>
              <p className="text-xs text-muted-foreground">Switch between light and dark mode</p>
            </div>
            <Button variant="outline" onClick={toggleTheme} className="gap-2">
              {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              {theme === "light" ? "Dark" : "Light"}
            </Button>
          </div>
        </div>

        {/* Webmaster-only: Promote */}
        {isWebmaster && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-1">
              <KeyRound className="h-5 w-5 text-primary" />
              Promote to Webmaster
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Grants the target account full webmaster access. The change is recorded in
              <code className="mx-1 rounded bg-muted px-1 py-0.5">roleGrants</code>
              and signed server-side via the <code className="mx-1 rounded bg-muted px-1 py-0.5">_serverRoleWrite</code> sentinel.
            </p>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="promote-email">Target user email</Label>
                <Input
                  id="promote-email"
                  type="email"
                  placeholder="user@example.com"
                  value={promoteEmail}
                  onChange={(e) => setPromoteEmail(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <Button onClick={handlePromote} disabled={promoting || !promoteEmail.trim()} className="gap-2">
                <KeyRound className="h-4 w-4" />
                {promoting ? "Granting…" : "Grant webmaster role"}
              </Button>
            </div>
          </div>
        )}

        {/* Webmaster-only: Pending escalation requests */}
        {isWebmaster && (
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-1">
              <Inbox className="h-5 w-5 text-primary" />
              Pending escalation requests
              {pending.length > 0 && (
                <Badge variant="secondary" className="ml-1">{pending.length}</Badge>
              )}
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Approve to grant the user escalated access to Integrations, Analytics, and Gmail API.
              Both decisions are written to <code className="rounded bg-muted px-1 py-0.5">escalationRequests</code>.
            </p>
            {pending.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No pending requests.
              </div>
            ) : (
              <div className="space-y-2">
                {pending.map((req) => (
                  <div
                    key={req.id}
                    className="rounded-lg border border-border bg-background p-3 flex flex-col sm:flex-row gap-3 sm:items-center"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {req.requesterName || req.requesterEmail || req.requesterUid}
                        </span>
                        <Badge variant="outline" className="capitalize text-[10px]">{req.requesterRole}</Badge>
                        {req.emailSent && (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <Send className="h-2.5 w-2.5" /> Email sent
                          </Badge>
                        )}
                      </div>
                      {req.requesterEmail && req.requesterName && (
                        <p className="text-xs text-muted-foreground truncate">{req.requesterEmail}</p>
                      )}
                      {req.reason && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">"{req.reason}"</p>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-1">{formatTime(req.createdAt)}</p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        disabled={decidingId === req.id}
                        onClick={() => decide(req.id, "deny")}
                      >
                        <X className="h-3.5 w-3.5" /> Deny
                      </Button>
                      <Button
                        size="sm"
                        className="gap-1"
                        disabled={decidingId === req.id}
                        onClick={() => decide(req.id, "approve")}
                      >
                        <Check className="h-3.5 w-3.5" />
                        {decidingId === req.id ? "…" : "Approve"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Webmaster-only: All accounts */}
        {isWebmaster && (
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-1">
              <Users className="h-5 w-5 text-primary" />
              Accounts
              <Badge variant="secondary" className="ml-1">{accounts.length}</Badge>
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Every account in the system. Deletion removes the user from Firebase Auth and Firestore — it cannot be undone.
              Each deletion is written to <code className="rounded bg-muted px-1 py-0.5">accountDeletions</code>.
            </p>
            <div className="space-y-2">
              {accounts.map((acc) => {
                const isSelf = acc.uid === user?.uid;
                return (
                  <div
                    key={acc.uid}
                    className="rounded-lg border border-border bg-background p-3 flex flex-col sm:flex-row gap-3 sm:items-center"
                  >
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {(acc.displayName || acc.email || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {acc.displayName || "(no name)"}
                        </span>
                        <Badge variant="secondary" className="capitalize text-[10px]">{acc.role}</Badge>
                        {acc.escalatedAccess && acc.role !== "webmaster" && (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <CheckCircle2 className="h-2.5 w-2.5" /> Escalated
                          </Badge>
                        )}
                        {isSelf && <Badge variant="outline" className="text-[10px]">You</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{acc.email || acc.uid}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Joined {formatTime(acc.createdAt)}</p>
                    </div>
                    <div className="flex flex-shrink-0 gap-2 flex-wrap">
                      {acc.escalatedAccess && acc.role !== "webmaster" && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              disabled={revokingUid === acc.uid}
                            >
                              <ShieldOff className="h-3.5 w-3.5" />
                              {revokingUid === acc.uid ? "Revoking…" : "Revoke escalation"}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Revoke escalated access?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {acc.email || acc.displayName || acc.uid} will lose access to Integrations,
                                Analytics, and the Gmail API. They can request escalation again later.
                                This action is recorded in <code className="rounded bg-muted px-1 py-0.5">roleGrants</code>.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => revokeEscalation(acc.uid, acc.email)}>
                                Revoke access
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 text-destructive hover:text-destructive"
                            disabled={isSelf || deletingUid === acc.uid}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {deletingUid === acc.uid ? "Deleting…" : "Delete"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this account?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently removes {acc.email || acc.displayName || acc.uid} from
                              Firebase Auth and Firestore. They will lose access immediately and cannot sign in again.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => deleteAccount(acc.uid, acc.email)}
                            >
                              Delete account
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                );
              })}
              {accounts.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No accounts yet.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Admin-only: Escalate */}
        {!isWebmaster && (
          <div className="rounded-xl border border-accent/40 bg-accent/5 p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-1">
              <Shield className="h-5 w-5 text-primary" />
              Escalate to Webmaster
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              {hasEscalatedAccess
                ? `You currently have escalated access to Integrations, Analytics, and the Gmail API. A webmaster can revoke this at any time.`
                : `Your admin account doesn't have access to Integrations, Analytics, or the Gmail API. Request escalation to notify a webmaster (${ESCALATION_NOTIFY_EMAIL}).`}
            </p>

            {!hasEscalatedAccess && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="escalate-reason">Reason (optional)</Label>
                  <Textarea
                    id="escalate-reason"
                    placeholder="Why do you need access to Integrations / Analytics / Gmail?"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    maxLength={500}
                  />
                </div>
                <Button onClick={handleEscalate} disabled={requesting} className="gap-2">
                  <Send className="h-4 w-4" />
                  {requesting ? "Sending…" : "Request escalation"}
                </Button>
              </div>
            )}

            {latestRequest && !hasEscalatedAccess && (
              <div className="mt-4 rounded-lg border border-border bg-card p-3 text-xs">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  Last request: <span className="capitalize">{latestRequest.status}</span>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {latestRequest.emailSent
                    ? `Notification email delivered to ${ESCALATION_NOTIFY_EMAIL}.`
                    : `Request logged. Email will go out once SMTP is configured on the Cloud Function.`}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Security */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-4">
            <Shield className="h-5 w-5 text-primary" />
            Security
          </h3>
          <p className="text-sm text-muted-foreground">
            Authentication is managed via Firebase. Use the Firebase Console to reset your password or enable MFA.
            Role changes are server-enforced — the <code className="rounded bg-muted px-1 py-0.5">enforceUserRoleOnWrite</code> trigger
            reverts any client-side tampering.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
