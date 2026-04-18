import React from "react";
import { Phone, MessageSquare } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";

/**
 * WebmasterContactButtons — direct call/SMS shortcuts to the on-call
 * webmaster. Surfaced for agents and admins (the webmaster doesn't need to
 * call themselves). Uses standard `tel:` / `sms:` URIs so the OS handles the
 * dial / compose action; no Twilio round-trip needed.
 *
 * The SMS button prefills the body with the sender's name and current
 * route so the webmaster gets instant context (e.g. "Hi, this is Sam from
 * /conversations/abc123 — ").
 *
 * Number is hard-coded per ops decision — change in one place if it moves.
 */
const WEBMASTER_NUMBER = "+17206639706"; // (720) 663-9706
const DISPLAY_NUMBER = "(720) 663-9706";

interface Props {
  /** "compact" = icon-only buttons (sidebar/bottom-sheet); "full" = labelled. */
  variant?: "compact" | "full";
  className?: string;
}

/**
 * Build the `sms:` href with a prefilled body. We use the `?body=` query
 * (iOS) and `?&body=` is not needed — both iOS and Android Messages parse
 * `?body=`. We URL-encode to keep spaces and punctuation intact, and trim
 * the route to a sensible length so the composer isn't dominated by a
 * massive deep link.
 */
function buildSmsHref(name: string, route: string): string {
  const safeName = name.trim() || "a teammate";
  const safeRoute = (route || "/").slice(0, 80);
  const body = `Hi, this is ${safeName} from ${safeRoute} — `;
  return `sms:${WEBMASTER_NUMBER}?body=${encodeURIComponent(body)}`;
}

const WebmasterContactButtons: React.FC<Props> = ({ variant = "full", className }) => {
  const { profile } = useAuth();
  const location = useLocation();

  // Hide for the webmaster themselves — they're the ones being called.
  if (!profile || profile.role === "webmaster") return null;

  const compact = variant === "compact";
  const senderName = profile.displayName || profile.email?.split("@")[0] || "a teammate";
  const smsHref = buildSmsHref(senderName, location.pathname);

  return (
    <div className={["flex items-center gap-2", className].filter(Boolean).join(" ")}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            variant="outline"
            size={compact ? "icon" : "sm"}
            className={compact ? "h-9 w-9" : "flex-1 justify-center gap-2"}
          >
            <a href={`tel:${WEBMASTER_NUMBER}`} aria-label={`Call webmaster at ${DISPLAY_NUMBER}`}>
              <Phone className="h-4 w-4" />
              {!compact && <span>Call</span>}
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Call webmaster · {DISPLAY_NUMBER}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            variant="outline"
            size={compact ? "icon" : "sm"}
            className={compact ? "h-9 w-9" : "flex-1 justify-center gap-2"}
          >
            <a href={smsHref} aria-label={`Text webmaster at ${DISPLAY_NUMBER}`}>
              <MessageSquare className="h-4 w-4" />
              {!compact && <span>Text</span>}
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Text webmaster · prefilled with your name &amp; page
        </TooltipContent>
      </Tooltip>
    </div>
  );
};

export default WebmasterContactButtons;

