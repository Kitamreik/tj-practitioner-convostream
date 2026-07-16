import { useEffect, useRef } from "react";
import { toast } from "@/hooks/use-toast";

/**
 * Real-time notifier for signed-in customers: when the webmaster flips the
 * public portal switch OFF, every open tab surfaces a toast explaining why
 * the UI just replaced itself with the PortalClosed screen.
 *
 * The redirect itself is handled by CustomerRoute re-rendering as soon as
 * `subscribePortalEnabled` reports `false` (Firestore onSnapshot in this
 * tab, or a cross-tab `storage` event fired by another tab's snapshot).
 * This hook only owns the user-visible toast so a customer isn't left
 * wondering what just happened.
 *
 * The hook tracks the previous value so it only fires on a true→false
 * transition — not on the initial load when the portal was already off.
 */
export function useCustomerPortalKillNotification(
  enabled: boolean,
  role: string | undefined
): void {
  const prev = useRef<boolean | null>(null);
  useEffect(() => {
    if (role !== "customer") {
      prev.current = enabled;
      return;
    }
    if (prev.current === true && enabled === false) {
      toast({
        title: "Customer portal closed",
        description:
          "The team has temporarily disabled the customer portal. You'll be able to sign back in once it reopens.",
        variant: "destructive",
      });
    }
    prev.current = enabled;
  }, [enabled, role]);
}
