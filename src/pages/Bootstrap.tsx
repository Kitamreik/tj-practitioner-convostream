/**
 * /bootstrap — one-shot first-time setup page.
 *
 * Calls the `bootstrapSupportAccount` Cloud Function, which:
 *   - Refuses to run if any user already has role="webmaster".
 *   - Creates support@convohub.dev in Firebase Auth (using the password
 *     entered here) if it doesn't already exist.
 *   - Sets that account's profile to role=webmaster + supportAccess=true.
 *
 * The page is intentionally unauthenticated. The Cloud Function is the
 * source of truth for whether bootstrap is allowed — the client cannot
 * read `users/*` without being signed in, so we don't try to second-guess
 * the gate from here. After a successful run, we show the credentials and
 * link to /login.
 */
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { z } from "zod";
import { functions } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, ShieldCheck } from "lucide-react";

const SUPPORT_EMAIL = "support@convohub.dev";

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be 128 characters or fewer.");

type CallResult = {
  ok: true;
  uid: string;
  email: string;
  created: boolean;
};

const Bootstrap: React.FC = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CallResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      setErrorMsg(parsed.error.issues[0]?.message ?? "Invalid password.");
      return;
    }
    if (password !== confirm) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const fn = httpsCallable<{ initialPassword: string }, CallResult>(
        functions,
        "bootstrapSupportAccount"
      );
      const res = await fn({ initialPassword: password });
      setResult(res.data);
      toast({
        title: "Bootstrap complete",
        description: res.data.created
          ? `Created ${res.data.email} as the initial webmaster.`
          : `Promoted existing ${res.data.email} to webmaster.`,
      });
    } catch (err: unknown) {
      const message =
        (err as { message?: string })?.message ?? "Bootstrap failed. See console for details.";
      // Firebase callable errors include a `code` like "functions/failed-precondition".
      const code = (err as { code?: string })?.code ?? "";
      if (code.includes("failed-precondition")) {
        setErrorMsg(
          "Bootstrap is no longer available — a webmaster already exists. Sign in and use Settings → Accounts to manage roles."
        );
      } else if (code.includes("not-found") || /404/.test(message)) {
        setErrorMsg(
          "The bootstrapSupportAccount Cloud Function is not deployed. Run `cd functions && firebase deploy --only functions:bootstrapSupportAccount`."
        );
      } else {
        setErrorMsg(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <CardTitle className="font-display text-2xl">First-time setup</CardTitle>
          <CardDescription>
            Provision the initial Support &amp; webmaster account for ConvoHub. This page is only
            usable until the first webmaster exists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {result ? (
            <div className="space-y-4">
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>You're all set</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>
                    {result.created ? "Created" : "Promoted"}{" "}
                    <span className="font-mono text-foreground">{result.email}</span> as the
                    initial webmaster with Support access.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Save the password you entered — Firebase Auth never returns it. Webmasters can
                    rotate it later from Settings → Accounts.
                  </p>
                </AlertDescription>
              </Alert>
              <Button className="w-full" onClick={() => navigate("/login")}>
                Go to login
              </Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-1.5">
                <Label>Account email</Label>
                <Input value={SUPPORT_EMAIL} disabled readOnly className="font-mono" />
                <p className="text-xs text-muted-foreground">
                  Hard-coded — the bootstrap function only provisions this address.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bootstrap-password">Password</Label>
                <Input
                  id="bootstrap-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  minLength={8}
                  maxLength={128}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bootstrap-confirm">Confirm password</Label>
                <Input
                  id="bootstrap-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  maxLength={128}
                />
              </div>

              {errorMsg && (
                <Alert variant="destructive">
                  <AlertDescription>{errorMsg}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Provisioning…" : "Provision support@convohub.dev"}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                Already set up?{" "}
                <Link to="/login" className="underline underline-offset-2">
                  Go to login
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Bootstrap;
