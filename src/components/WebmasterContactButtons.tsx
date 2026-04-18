import React, { useEffect, useRef, useState } from "react";
import { Phone, MessageSquare, Clock } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

/**
 * WebmasterContactButtons — direct call/SMS shortcuts to the on-call
 * webmaster. Surfaced for agents and admins (the webmaster doesn't need to
 * call themselves). Uses standard `tel:` / `sms:` URIs so the OS handles the
 * dial / compose action; no Twilio round-trip needed.
 *
 * UX details:
 * - SMS body is prefilled with the sender's name and current route so the
 *   webmaster gets instant context.
 * - The tel: link includes a `;phone-context=` segment carrying the same
 *   context string. Most modern dialers ignore unknown URI params, but
 *   compliant ones (per RFC 3966) will surface it in the dial-pad notes.
 * - Long-pressing either button copies the full context line to the
 *   clipboard so agents on carriers that strip SMS bodies (or whose dialer
 *   ignores the param) still have the message ready to paste.
 * - A "Last contacted X min ago" hint renders under the buttons so an
 *   agent doesn't double-text the webmaster mid-incident. Tracked in
 *   localStorage per user.
 *
 * Number is hard-coded per ops decision — change in one place if it moves.
 */
const WEBMASTER_NUMBER = "+17206639706"; // (720) 663-9706
const DISPLAY_NUMBER = "(720) 663-9706";
const LAST_CONTACT_KEY_PREFIX = "convohub.webmasterLastContact.";
const LONG_PRESS_MS = 500;

interface Props {
  /** "compact" = icon-only buttons (sidebar/bottom-sheet); "full" = labelled. */
  variant?: "compact" | "full";
  className?: string;
}

function buildContextLine(name: string, route: string): string {
  const safeName = name.trim() || "a teammate";
  const safeRoute = (route || "/").slice(0, 80);
  return `Hi, this is ${safeName} from ${safeRoute} — `;
}

function buildSmsHref(name: string, route: string): string {
  const body = buildContextLine(name, route);
  return `sms:${WEBMASTER_NUMBER}?body=${encodeURIComponent(body)}`;
}

/**
 * RFC 3966 allows extra parameters on tel: URIs. Compliant dialers may show
 * the context in their notes field; non-compliant ones simply ignore it and
 * still dial the number, so this is a safe progressive enhancement.
 */
function buildTelHref(name: string, route: string): string {
  const ctx = buildContextLine(name, route).trim();
  return `tel:${WEBMASTER_NUMBER};phone-context=${encodeURIComponent(ctx)}`;
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const WebmasterContactButtons: React.FC<Props> = ({ variant = "full", className }) => {
  const { profile } = useAuth();
  const location = useLocation();
  const [lastContactMs, setLastContactMs] = useState<number | null>(null);
  // Tick every 30s so the relative label stays fresh without rerendering
  // the whole tree on every frame.
  const [, setNowTick] = useState(0);

  const lastKey = profile?.uid ? LAST_CONTACT_KEY_PREFIX + profile.uid : null;

  useEffect(() => {
    if (!lastKey) return;
    try {
      const raw = localStorage.getItem(lastKey);
      const n = raw ? Number(raw) : NaN;
      setLastContactMs(Number.isFinite(n) ? n : null);
    } catch {
      setLastContactMs(null);
    }
  }, [lastKey]);

  useEffect(() => {
    if (!lastContactMs) return;
    const id = window.setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, [lastContactMs]);

  // Long-press handlers — copy the context line to the clipboard. Works
  // for both mouse and touch. We cancel on pointer-leave/up to avoid
  // firing when the user just clicks the link normally.
  const pressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const cancelLongPress = () => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  // Hide for the webmaster themselves — they're the ones being called.
  if (!profile || profile.role === "webmaster") return null;

  const compact = variant === "compact";
  const senderName = profile.displayName || profile.email?.split("@")[0] || "a teammate";
  const contextLine = buildContextLine(senderName, location.pathname);
  const smsHref = buildSmsHref(senderName, location.pathname);
  const telHref = buildTelHref(senderName, location.pathname);

  const recordContact = () => {
    if (!lastKey) return;
    const now = Date.now();
    try {
      localStorage.setItem(lastKey, String(now));
    } catch {
      /* private mode — silent */
    }
    setLastContactMs(now);
  };

  const startLongPress = () => {
    longPressFiredRef.current = false;
    cancelLongPress();
    pressTimerRef.current = window.setTimeout(async () => {
      longPressFiredRef.current = true;
      try {
        await navigator.clipboard.writeText(contextLine);
        toast({
          title: "Context copied",
          description: "Paste it into your SMS or call notes.",
        });
      } catch {
        toast({
          title: "Copy failed",
          description: "Long-press copy isn't supported on this device.",
          variant: "destructive",
        });
      }
    }, LONG_PRESS_MS);
  };

  // Suppress the link navigation if the long-press fired (so the user
  // doesn't also get bounced into the dialer/composer).
  const guardClick = (e: React.MouseEvent) => {
    if (longPressFiredRef.current) {
      e.preventDefault();
      longPressFiredRef.current = false;
      return;
    }
    recordContact();
  };

  return (
    <div className={["flex flex-col gap-1.5", className].filter(Boolean).join(" ")}>
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              variant="outline"
              size={compact ? "icon" : "sm"}
              className={compact ? "h-9 w-9" : "flex-1 justify-center gap-2"}
            >
              <a
                href={telHref}
                aria-label={`Call webmaster at ${DISPLAY_NUMBER}. Long-press to copy context.`}
                onClick={guardClick}
                onMouseDown={startLongPress}
                onMouseUp={cancelLongPress}
                onMouseLeave={cancelLongPress}
                onTouchStart={startLongPress}
                onTouchEnd={cancelLongPress}
                onTouchCancel={cancelLongPress}
                onContextMenu={(e) => e.preventDefault()}
              >
                <Phone className="h-4 w-4" />
                {!compact && <span>Call</span>}
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[220px]">
            Call webmaster · {DISPLAY_NUMBER}
            <div className="mt-1 text-muted-foreground">Long-press to copy context line.</div>
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
              <a
                href={smsHref}
                aria-label={`Text webmaster at ${DISPLAY_NUMBER}. Long-press to copy context.`}
                onClick={guardClick}
                onMouseDown={startLongPress}
                onMouseUp={cancelLongPress}
                onMouseLeave={cancelLongPress}
                onTouchStart={startLongPress}
                onTouchEnd={cancelLongPress}
                onTouchCancel={cancelLongPress}
                onContextMenu={(e) => e.preventDefault()}
              >
                <MessageSquare className="h-4 w-4" />
                {!compact && <span>Text</span>}
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[220px]">
            Text webmaster · prefilled with your name &amp; page.
            <div className="mt-1 text-muted-foreground">Long-press to copy context line.</div>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Last-contacted hint — only renders once an agent has actually
          tapped one of the buttons in this browser. Keeps the footprint
          tiny when there's no recent activity. */}
      {lastContactMs && (
        <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-2.5 w-2.5" />
          Last contacted webmaster {formatRelative(lastContactMs)}
        </p>
      )}
    </div>
  );
};

export default WebmasterContactButtons;
