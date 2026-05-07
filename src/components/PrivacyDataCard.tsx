import React, { useState } from "react";
import { Download, ShieldAlert, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Privacy & data card for the Settings page. Lets a signed-in user export
 * their personal data and request account deletion (30-day soft-delete).
 * Honors the data-subject rights described in the Privacy Policy.
 */
const PrivacyDataCard: React.FC = () => {
  const { user, profile } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const onExport = async () => {
    if (!user) return;
    setExporting(true);
    try {
      const fn = httpsCallable<unknown, { ok: boolean; data: unknown }>(functions, "exportMyData");
      const res = await fn({});
      const payload = (res.data as { data: unknown }).data;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `convohub-export-${user.uid}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export ready", description: "Your data has been downloaded." });
    } catch (err: any) {
      toast({
        title: "Export failed",
        description: err?.message || "Could not generate export.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const onDelete = async () => {
    setDeleting(true);
    try {
      const fn = httpsCallable<unknown, { ok: boolean; scheduledFor: string }>(
        functions,
        "requestAccountDeletion",
      );
      const res = await fn({});
      toast({
        title: "Deletion requested",
        description: `Your account will be permanently deleted on ${new Date(res.data.scheduledFor).toLocaleDateString()}.`,
      });
    } catch (err: any) {
      toast({
        title: "Could not request deletion",
        description: err?.message || "Try again later.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card id="privacy-data" className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-primary" /> Privacy &amp; data
        </CardTitle>
        <CardDescription>
          Exercise your GDPR/CCPA rights. Export a copy of your personal data or
          request permanent deletion of your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{profile?.email}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onExport} disabled={exporting || !user}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export my data
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={deleting || !user}>
                Delete my account
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Permanently delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your account will be marked for deletion and permanently removed
                  in 30 days. You can cancel by signing in again and contacting{" "}
                  <a href="mailto:privacy@convohub.dev" className="underline">
                    privacy@convohub.dev
                  </a>{" "}
                  before the deletion date.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Request deletion</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
};

export default PrivacyDataCard;
