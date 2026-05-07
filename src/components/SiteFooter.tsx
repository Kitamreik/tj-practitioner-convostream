import React from "react";
import { Link } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { openConsentBanner } from "@/lib/cookieConsent";

/**
 * Global site footer rendered on every authenticated page (via AppLayout)
 * and on public pages (Login, Forgot/Reset Password, Bootstrap, /legal/*).
 *
 * Sections collapse to a single column on mobile and expand to four on md+.
 * Honors the warm aesthetic: amber/coral primary, Playfair headings, DM Sans body.
 */
const SiteFooter: React.FC<{ variant?: "app" | "public" }> = ({ variant = "app" }) => {
  const auth = (() => {
    try { return useAuth(); } catch { return { user: null } as ReturnType<typeof useAuth>; }
  })();
  const signedIn = !!auth.user;
  const year = new Date().getFullYear();

  return (
    <footer
      role="contentinfo"
      className="mt-12 border-t border-border bg-card/40"
    >
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <MessageCircle className="h-4 w-4 text-primary-foreground" />
            </div>
            <span
              className="text-lg font-semibold text-foreground"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              ConvoHub
            </span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Customer conversations, kept warm and continuous.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">© {year} ConvoHub. All rights reserved.</p>
        </div>

        {signedIn && variant === "app" && (
          <div>
            <h3 className="text-sm font-semibold text-foreground">Product</h3>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li><Link to="/" className="hover:text-primary">Conversations</Link></li>
              <li><Link to="/chat" className="hover:text-primary">Team chat</Link></li>
              <li><Link to="/notifications" className="hover:text-primary">Notifications</Link></li>
              <li><Link to="/settings" className="hover:text-primary">Settings</Link></li>
            </ul>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold text-foreground">Legal</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li><Link to="/legal/terms" className="hover:text-primary">Terms of Service</Link></li>
            <li><Link to="/legal/privacy" className="hover:text-primary">Privacy Policy</Link></li>
            <li><Link to="/legal/cookies" className="hover:text-primary">Cookie Policy</Link></li>
            <li><Link to="/legal/dpa" className="hover:text-primary">Data Processing Addendum</Link></li>
            <li><Link to="/legal/acceptable-use" className="hover:text-primary">Acceptable Use</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-foreground">Contact</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <a href="mailto:support@convohub.dev" className="hover:text-primary">
                support@convohub.dev
              </a>
            </li>
            <li>
              <a href="mailto:privacy@convohub.dev" className="hover:text-primary">
                privacy@convohub.dev
              </a>
            </li>
            <li>
              <button
                type="button"
                onClick={openConsentBanner}
                className="text-left hover:text-primary"
              >
                Cookie preferences
              </button>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border bg-background/40">
        <p className="mx-auto max-w-6xl px-4 py-3 text-xs text-muted-foreground">
          We use essential cookies to run ConvoHub and optional analytics cookies with
          your consent. See our{" "}
          <Link to="/legal/cookies" className="underline hover:text-primary">Cookie Policy</Link>{" "}
          for details.
        </p>
      </div>
    </footer>
  );
};

export default SiteFooter;
