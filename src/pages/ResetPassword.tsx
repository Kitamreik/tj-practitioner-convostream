import React, { useState, useEffect } from "react";
import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { motion } from "framer-motion";
import { MessageCircle, Eye, EyeOff, CheckCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Link, useSearchParams } from "react-router-dom";

const ResetPassword: React.FC = () => {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const oobCode = searchParams.get("oobCode") || "";
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState("");
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!oobCode) {
      setInvalid(true);
      return;
    }
    verifyPasswordResetCode(auth, oobCode)
      .then((e) => setEmail(e))
      .catch(() => setInvalid(true));
  }, [oobCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPw) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
      setDone(true);
      toast({ title: "Password reset successfully" });
    } catch (error: any) {
      toast({ title: "Reset failed", description: error?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
            <MessageCircle className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">ConvoHub</h1>
        </div>

        <div className="rounded-2xl border border-border bg-card p-8 shadow-lg">
          {invalid ? (
            <div className="text-center space-y-4">
              <h2 className="text-xl font-semibold text-card-foreground">Invalid or Expired Link</h2>
              <p className="text-sm text-muted-foreground">This password reset link is no longer valid.</p>
              <Link to="/forgot-password">
                <Button className="w-full mt-4">Request a New Link</Button>
              </Link>
            </div>
          ) : done ? (
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <CheckCircle className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-card-foreground">Password Reset!</h2>
              <p className="text-sm text-muted-foreground">You can now sign in with your new password.</p>
              <Link to="/login">
                <Button className="w-full mt-4">Sign In</Button>
              </Link>
            </div>
          ) : (
            <>
              <h2 className="mb-2 text-center text-xl font-semibold text-card-foreground">Set New Password</h2>
              {email && (
                <p className="mb-6 text-center text-sm text-muted-foreground">
                  Resetting password for <strong>{email}</strong>
                </p>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPw">Confirm Password</Label>
                  <Input
                    id="confirmPw"
                    type="password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Resetting..." : "Reset Password"}
                </Button>
              </form>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default ResetPassword;
