/**
 * Webmaster-only Settings panel that seeds demo escalation/signup/
 * investigation data so QA + preview deploys always have something to
 * render in the related panels — and lets webmasters wipe customer
 * accounts in one click to keep the seeded state clean.
 */
import React, { useState } from "react";
import { Sprout, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import {
  deleteAllCustomerAccounts,
  seedAllDemoData,
  type SeedSummary,
} from "@/lib/seedDemoData";

const DataSeedPanel: React.FC = () => {
  const { profile } = useAuth();
  const [seeding, setSeeding] = useState(false);
  const [purging, setPurging] = useState(false);
  const [lastSummary, setLastSummary] = useState<SeedSummary | null>(null);

  if (profile?.role !== "webmaster") return null;

  const runSeed = async () => {
    setSeeding(true);
    try {
      const summary = await seedAllDemoData({
        uid: profile.uid,
        email: profile.email ?? null,
        displayName: profile.displayName ?? null,
      });
      setLastSummary(summary);
      toast({
        title: "Demo data seeded",
        description: `Escalations: ${summary.escalations} · Signups: ${summary.signups} · Investigations: ${summary.investigations} · Customer signups: ${summary.customers} · Rejected customers: ${summary.rejectedCustomers}`,
      });
    } catch (err: unknown) {
      toast({
        title: "Seeding failed",
        description: (err as { message?: string })?.message ?? "Check Firestore rules.",
        variant: "destructive",
      });
    } finally {
      setSeeding(false);
    }
  };

  const runDeleteCustomers = async () => {
    setPurging(true);
    try {
      const { deleted, failures } = await deleteAllCustomerAccounts(profile.uid);
      toast({
        title: "Customer cleanup complete",
        description: `Deleted ${deleted.length}${failures.length ? `, ${failures.length} failed` : ""}.`,
        variant: failures.length ? "destructive" : "default",
      });
    } catch (err: unknown) {
      toast({
        title: "Customer cleanup failed",
        description: (err as { message?: string })?.message ?? "Unknown error.",
        variant: "destructive",
      });
    } finally {
      setPurging(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sprout className="h-5 w-5 text-primary" />
          Demo data & customer cleanup
        </CardTitle>
        <CardDescription>
          Seed reproducible sample documents into escalation requests, pending signup approvals,
          and the investigation queue. All seeded rows are tagged{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">seedDemo: true</code> with
          deterministic <code className="rounded bg-muted px-1 py-0.5 text-xs">seed-*</code> ids so
          re-running the seeder is idempotent and never duplicates entries.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={runSeed} disabled={seeding} className="gap-2">
            {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sprout className="h-4 w-4" />}
            {seeding ? "Seeding…" : "Seed demo data"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={purging} className="gap-2">
                {purging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {purging ? "Deleting…" : "Delete all customer accounts"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete every customer account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes every user with <code>role === "customer"</code> from
                  Firebase Auth and Firestore. Internal roles (agent/admin/webmaster) are not
                  affected. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={runDeleteCustomers}>
                  Delete customers
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        {lastSummary && (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
            Last seed: {lastSummary.escalations} escalations · {lastSummary.signups} pending
            signups · {lastSummary.investigations} investigations ·{" "}
            {lastSummary.customers} customer signups · {lastSummary.rejectedCustomers} rejected customers. Open the panels above to verify
            persistence.
          </div>
        )}
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
          <p className="font-medium text-foreground mb-1">Authorized domains — quick directions</p>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>
              Use the <span className="font-medium text-foreground">Firebase authorized domains</span>{" "}
              panel above to add every host that will serve the app (preview, published, custom
              domains). The current host shows a one-click <em>Add this domain</em> shortcut if it
              is missing.
            </li>
            <li>
              Authorized domains are required for password-reset / email-link
              <code className="mx-1 rounded bg-muted px-1 py-0.5">continueUrl</code> values —
              without them Firebase returns{" "}
              <code className="rounded bg-muted px-1 py-0.5">auth/unauthorized-continue-uri</code>.
            </li>
            <li>
              The panel is wired to the{" "}
              <code className="rounded bg-muted px-1 py-0.5">listAuthorizedDomains</code> /
              <code className="ml-1 rounded bg-muted px-1 py-0.5">addAuthorizedDomain</code> /
              <code className="ml-1 rounded bg-muted px-1 py-0.5">removeAuthorizedDomain</code>{" "}
              Cloud Functions, which call the Identity Toolkit Admin API with the function
              service-account credentials — no manual console steps needed.
            </li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
};

export default DataSeedPanel;
