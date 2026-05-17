import React from "react";
import { motion } from "framer-motion";
import { ShieldCheck, LogOut, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import SiteFooter from "@/components/SiteFooter";

const PendingApproval: React.FC = () => {
  const { profile, signOut } = useAuth();
  const rejected = profile?.approvalStatus === "rejected";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              {rejected ? (
                <XCircle className="h-8 w-8 text-destructive" />
              ) : (
                <Clock className="h-8 w-8 text-primary" />
              )}
            </div>
            <h1
              className="text-2xl font-semibold text-foreground"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              {rejected ? "Account not approved" : "Awaiting approval"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {rejected
                ? "Your account was reviewed and not approved for access. If you believe this is a mistake, contact the workspace owner."
                : "Thanks for signing up. A workspace owner needs to verify your identity against the team roster before you can access the platform."}
            </p>
            {rejected && profile?.rejectionNote ? (
              <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-left text-xs text-muted-foreground">
                <strong className="text-destructive">Note from reviewer:</strong>{" "}
                {profile.rejectionNote}
              </p>
            ) : null}
            <div className="mt-6 flex flex-col gap-2">
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" />
                Signed in as <span className="font-medium">{profile?.displayName}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full gap-1.5"
                onClick={() => signOut()}
              >
                <LogOut className="h-4 w-4" /> Sign out
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
      <SiteFooter variant="public" />
    </div>
  );
};

export default PendingApproval;
