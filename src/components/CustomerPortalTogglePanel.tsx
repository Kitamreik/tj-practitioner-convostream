import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader2, DoorOpen, DoorClosed } from "lucide-react";
import { subscribePortalEnabled, setPortalEnabled } from "@/lib/portalStatus";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

/**
 * Webmaster-only toggle for the public customer portal. When disabled:
 *  - /portal/login and /portal/signup render a "portal closed" message
 *  - The CustomerRoute guard bounces signed-in customers to a closed screen
 *  - Existing customer accounts remain intact — the toggle only gates the UI
 *    surface, so flipping it back on restores access without data loss.
 */
const CustomerPortalTogglePanel: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribePortalEnabled(setEnabled), []);

  const onToggle = async (next: boolean) => {
    if (!user) return;
    setBusy(true);
    try {
      await setPortalEnabled(next, user.uid);
      toast({
        title: next ? "Customer portal opened" : "Customer portal closed",
        description: next
          ? "Sign-in and sign-up pages are live again."
          : "New and existing customers see a closed-for-maintenance screen.",
      });
    } catch (err: any) {
      toast({
        title: "Could not update portal state",
        description: err?.message ?? "Try again shortly.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {enabled === false ? (
            <DoorClosed className="h-5 w-5 text-destructive" />
          ) : (
            <DoorOpen className="h-5 w-5 text-primary" />
          )}
          Customer portal access
          {enabled !== null && (
            <Badge variant={enabled ? "default" : "destructive"} className="ml-2">
              {enabled ? "Open" : "Closed"}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Master switch for the public /portal/* routes. Closing the portal blocks new customer
          sign-ups and sign-ins without touching any existing data.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="text-sm text-muted-foreground">
          {enabled === null
            ? "Loading…"
            : enabled
              ? "The portal is open — customers can reach Team Chat."
              : "The portal is closed — customers see a maintenance notice."}
        </div>
        <div className="flex items-center gap-2">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Switch
            aria-label="Toggle customer portal"
            checked={enabled === true}
            disabled={busy || enabled === null}
            onCheckedChange={(v) => void onToggle(v)}
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default CustomerPortalTogglePanel;
