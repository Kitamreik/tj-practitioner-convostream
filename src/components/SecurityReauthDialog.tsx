import React, { useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { Lock } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
  /** Called after `MAX_FAILS` wrong attempts — caller locks the panel. */
  onLockout: () => void;
  failCount: number;
  setFailCount: (n: number) => void;
}

const MAX_FAILS = 3;

/**
 * Password re-authentication gate for revealing sensitive security findings.
 *
 * Uses Firebase's `reauthenticateWithCredential` so the password is verified
 * against the live Auth backend without exposing it to our application code.
 * After 3 wrong attempts the caller locks the reveal panel for 15 minutes
 * (state stored in sessionStorage by the parent).
 */
const SecurityReauthDialog: React.FC<Props> = ({
  open,
  onOpenChange,
  onSuccess,
  onLockout,
  failCount,
  setFailCount,
}) => {
  const { user } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const remaining = Math.max(0, MAX_FAILS - failCount);

  const handleVerify = async () => {
    if (!user?.email || !auth.currentUser) {
      toast({
        title: "Cannot verify",
        description: "No active session.",
        variant: "destructive",
      });
      return;
    }
    if (!password) return;
    setBusy(true);
    try {
      const cred = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(auth.currentUser, cred);
      setPassword("");
      setFailCount(0);
      onOpenChange(false);
      onSuccess();
    } catch (err: unknown) {
      const next = failCount + 1;
      setFailCount(next);
      setPassword("");
      if (next >= MAX_FAILS) {
        toast({
          title: "Too many failed attempts",
          description: "Security findings panel locked for 15 minutes.",
          variant: "destructive",
        });
        onOpenChange(false);
        onLockout();
      } else {
        const msg = err instanceof Error ? err.message : "Wrong password.";
        toast({
          title: "Verification failed",
          description: `${msg} · ${MAX_FAILS - next} attempt${
            MAX_FAILS - next === 1 ? "" : "s"
          } remaining.`,
          variant: "destructive",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" /> Re-enter password
          </DialogTitle>
          <DialogDescription>
            Security findings contain sensitive details (affected collections,
            review notes, severity context). Confirm your account password to
            reveal them for this session.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reauth-pwd">Password</Label>
          <Input
            id="reauth-pwd"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleVerify();
            }}
            autoFocus
          />
          {failCount > 0 && (
            <p className="text-xs text-destructive">
              {remaining} attempt{remaining === 1 ? "" : "s"} remaining before
              the panel locks for 15 minutes.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={handleVerify} disabled={busy || !password}>
            {busy ? "Verifying…" : "Unlock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SecurityReauthDialog;
