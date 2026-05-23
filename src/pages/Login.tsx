import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";
import { MessageCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Link, useNavigate } from "react-router-dom";
import SiteFooter from "@/components/SiteFooter";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { signUpCustomer, claimConversationsForCustomer } from "@/lib/customerPortal";

/**
 * Combined sign-in landing page.
 *
 * The page now hosts two audience-specific flows behind a Tabs control so
 * customers and staff land in the same place but get routed to the right
 * backend:
 *
 *   - **Staff** uses the existing AuthContext signIn/signUp helpers and
 *     lands inside the agent app (`/`). New staff accounts go through the
 *     webmaster approval queue (see PendingApproval).
 *   - **Customer** uses `signUpCustomer` / Firebase `signInWithEmailAndPassword`
 *     directly (auto-approved, role = "customer") and lands in the customer
 *     portal at `/portal/conversations`. On sign-in we eagerly run
 *     `claimConversationsForCustomer` so any pre-existing conversations
 *     linked to the customer's email persist into their portal view.
 */
const Login: React.FC = () => {
  const { signIn, signUp } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [audience, setAudience] = useState<"staff" | "customer">("staff");
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const resetFields = () => {
    setEmail("");
    setPassword("");
    setDisplayName("");
    setShowPassword(false);
  };

  const handleStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isSignUp) {
        await signUp(email, password, displayName);
        toast({ title: "Account created", description: "Welcome to Kit TJ Services ClientHub!" });
      } else {
        await signIn(email, password);
        toast({ title: "Welcome back", description: "Signed in successfully." });
      }
    } catch (error: any) {
      console.warn("Auth error:", error?.code || error?.message);
      toast({
        title: "Authentication failed",
        description: "Invalid email or password.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSignUp && password.length < 8) {
      toast({
        title: "Password too short",
        description: "Customer passwords must be at least 8 characters.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      if (isSignUp) {
        await signUpCustomer(email.trim(), password, displayName.trim());
        toast({ title: "Account created", description: "Welcome — opening your conversations." });
      } else {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        // Best-effort: link any pre-existing conversations to this customer
        // so the portal shows full history immediately on first sign-in.
        void claimConversationsForCustomer(cred.user.uid, email.trim());
        toast({ title: "Welcome back" });
      }
      navigate("/portal/conversations", { replace: true });
    } catch (error: any) {
      console.warn("Customer auth error:", error?.code || error?.message);
      toast({
        title: isSignUp ? "Could not create account" : "Sign in failed",
        description: error?.message || "Check your email and password.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const showNameField = isSignUp;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 items-center justify-center p-4">
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
            <h1 className="text-3xl font-bold text-foreground">Kit TJ Services ClientHub</h1>
            <p className="mt-2 text-muted-foreground">
              People-centered conversations and enhancing client relations.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-lg sm:p-8">
            <Tabs
              value={audience}
              onValueChange={(v) => {
                setAudience(v as "staff" | "customer");
                setIsSignUp(false);
                resetFields();
              }}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="staff">Staff</TabsTrigger>
                <TabsTrigger value="customer">Customer</TabsTrigger>
              </TabsList>

              {/* -------- STAFF -------- */}
              <TabsContent value="staff" className="mt-6">
                <h2 className="mb-1 text-center text-xl font-semibold text-card-foreground">
                  {isSignUp ? "Create Staff Account" : "Staff Sign In"}
                </h2>
                <p className="mb-5 text-center text-xs text-muted-foreground">
                  New staff accounts require webmaster approval before access is granted.
                </p>
                <form onSubmit={handleStaffSubmit} className="space-y-4">
                  {showNameField && (
                    <div className="space-y-2">
                      <Label htmlFor="staff-name">Display Name</Label>
                      <Input
                        id="staff-name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your name"
                        required
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="staff-email">Email</Label>
                    <Input
                      id="staff-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@kittj.example"
                      autoComplete="email"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="staff-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="staff-password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        autoComplete={isSignUp ? "new-password" : "current-password"}
                        required
                        minLength={6}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isSignUp ? (
                      "Create Account"
                    ) : (
                      "Sign In"
                    )}
                  </Button>
                </form>
              </TabsContent>

              {/* -------- CUSTOMER -------- */}
              <TabsContent value="customer" className="mt-6">
                <h2 className="mb-1 text-center text-xl font-semibold text-card-foreground">
                  {isSignUp ? "Create Customer Account" : "Customer Sign In"}
                </h2>
                <p className="mb-5 text-center text-xs text-muted-foreground">
                  Track your conversations and rate replies in the customer portal.
                </p>
                <form onSubmit={handleCustomerSubmit} className="space-y-4">
                  {showNameField && (
                    <div className="space-y-2">
                      <Label htmlFor="cust-name">Name</Label>
                      <Input
                        id="cust-name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your name"
                        autoComplete="name"
                        required
                        maxLength={100}
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="cust-email">Email</Label>
                    <Input
                      id="cust-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      required
                      maxLength={255}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cust-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="cust-password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        autoComplete={isSignUp ? "new-password" : "current-password"}
                        required
                        minLength={isSignUp ? 8 : 6}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isSignUp ? (
                      "Create Account"
                    ) : (
                      "Sign In"
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            <div className="mt-6 space-y-2 text-center">
              <button
                onClick={() => setIsSignUp(!isSignUp)}
                className="text-sm text-primary hover:underline"
                type="button"
              >
                {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
              </button>
              {!isSignUp && (
                <div>
                  <Link
                    to="/forgot-password"
                    className="text-sm text-muted-foreground hover:text-primary hover:underline"
                  >
                    Forgot your password?
                  </Link>
                </div>
              )}
            </div>

            <p className="mt-6 text-center text-xs text-muted-foreground">
              By continuing you agree to our{" "}
              <Link to="/legal/terms" className="underline hover:text-primary">
                Terms
              </Link>{" "}
              and{" "}
              <Link to="/legal/privacy" className="underline hover:text-primary">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </motion.div>
      </div>
      <SiteFooter variant="public" />
    </div>
  );
};

export default Login;
