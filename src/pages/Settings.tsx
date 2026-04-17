import React, { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Moon, Sun, User, Shield, KeyRound, Send, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
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
