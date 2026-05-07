import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Cookie } from "lucide-react";
import {
  CONSENT_OPEN_EVENT,
  readConsent,
  writeConsent,
  type ConsentRecord,
} from "@/lib/cookieConsent";

/**
 * Bottom-of-page cookie consent banner. Shows on first visit and whenever
 * the user clicks "Cookie preferences" in the footer. Essential cookies are
 * always on; analytics cookies are opt-in.
 */
const CookieConsent: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [customize, setCustomize] = useState(false);

  useEffect(() => {
    const existing = readConsent();
    if (!existing) setOpen(true);
    else setAnalytics(existing.analytics);

    const handler = () => {
      const current = readConsent();
      setAnalytics(current?.analytics ?? false);
      setCustomize(true);
      setOpen(true);
    };
    window.addEventListener(CONSENT_OPEN_EVENT, handler as EventListener);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, handler as EventListener);
  }, []);

  const persist = (record: ConsentRecord) => {
    setAnalytics(record.analytics);
    setOpen(false);
    setCustomize(false);
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-border bg-card/95 backdrop-blur-sm shadow-lg"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <Cookie className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div className="text-sm text-foreground">
            <p className="font-medium" style={{ fontFamily: "'Playfair Display', serif" }}>
              We use cookies
            </p>
            <p className="text-muted-foreground">
              ConvoHub uses essential cookies to keep you signed in and remember your
              preferences. With your consent we also use optional analytics cookies to
              improve the product. See our{" "}
              <Link to="/legal/cookies" className="underline hover:text-primary">
                Cookie Policy
              </Link>{" "}
              and{" "}
              <Link to="/legal/privacy" className="underline hover:text-primary">
                Privacy Policy
              </Link>
              .
            </p>

            {customize && (
              <div className="mt-3 space-y-2 rounded-md border border-border bg-background/60 p-3">
                <label className="flex items-center justify-between text-sm">
                  <span>
                    <span className="font-medium">Essential</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      Required to run the app. Always on.
                    </span>
                  </span>
                  <Switch checked disabled aria-label="Essential cookies (required)" />
                </label>
                <label className="flex items-center justify-between text-sm">
                  <span>
                    <span className="font-medium">Analytics</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      Anonymous usage to improve ConvoHub.
                    </span>
                  </span>
                  <Switch
                    checked={analytics}
                    onCheckedChange={setAnalytics}
                    aria-label="Analytics cookies"
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 md:flex-nowrap md:justify-end">
          {!customize && (
            <Button variant="ghost" size="sm" onClick={() => setCustomize(true)}>
              Customize
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => persist(writeConsent(false))}>
            Essential only
          </Button>
          {customize ? (
            <Button size="sm" onClick={() => persist(writeConsent(analytics))}>
              Save preferences
            </Button>
          ) : (
            <Button size="sm" onClick={() => persist(writeConsent(true))}>
              Accept all
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CookieConsent;
