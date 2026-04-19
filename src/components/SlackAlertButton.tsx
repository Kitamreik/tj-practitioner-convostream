import React, { useEffect, useRef, useState } from "react";
import { Bell, Clock } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { subscribeSlackAlertConfigured, getLocalSlackAlertConfigured } from "@/lib/webmasterCooldown";
import { pingWebmasterSlackAlert } from "@/lib/notifyWebmaster";

/**
 * SlackAlertButton — standalone "ping the team Slack channel" action.
 *
 * Sits next to other top-of-thread actions (e.g. Elevate to webmaster). No
 * phone hand-off, no Call/Text contact record — purely an escalation ping
 * with the fixed review message, forwarded through the
 * `pingWebmasterSlack` Cloud Function (server-side webhook + rate limit +
 * contact-events log).
 *
 * Visibility: hidden for the webmaster role (they're the recipient).
 * Disabled when no Slack webhook is configured (the
 * `appSettings/slackAlertStatus.configured` mirror tells us).
 *
 * Rate limit: 10 minutes per user, enforced server-side. The countdown is
 * mirrored client-side in localStorage so the label is correct across
 * navigation/reloads without an extra Firestore read.
 */
const RATE_LIMIT_MS = 10 * 60 * 1000;
const LOCAL_KEY_NEXT_ALLOWED_PREFIX = "convohub.slackAlertNextAllowed.";

interface Props {
  className?: string;
  /** "compact" hides the label and shows just the bell icon. */
  variant?: "compact" | "full";
}

function readLocalNextAllowed(uid: string | null | undefined): number {
  if (!uid) return 0;
  try {
    const raw = localStorage.getItem(LOCAL_KEY_NEXT_ALLOWED_PREFIX + uid);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeLocalNextAllowed(uid: string | null | undefined, ts: number): void {
  if (!uid) return;
  try {
    localStorage.setItem(LOCAL_KEY_NEXT_ALLOWED_PREFIX + uid, String(ts));
  } catch {
    /* ignore */
  }
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

const SlackAlertButton: React.FC<Props> = ({ className, variant = "full" }) => {
  const { profile } = useAuth();
  const location = useLocation();
  const [configured, setConfigured] = useState<boolean>(() => getLocalSlackAlertConfigured());
  const [sending, setSending] = useState(false);
  // `nextAllowedAt` drives the disabled state + countdown label. We hydrate
  // from localStorage immediately so the cooldown survives page reloads.
  const [nextAllowedAt, setNextAllowedAt] = useState<number>(() => readLocalNextAllowed(profile?.uid));
  const [, setNowTick] = useState(0);
  const tickRef = useRef<number | null>(null);

  useEffect(() => subscribeSlackAlertConfigured(setConfigured), []);

  // Re-hydrate when the user changes (e.g. webmaster signs in as agent).
  useEffect(() => {
    setNextAllowedAt(readLocalNextAllowed(profile?.uid));
  }, [profile?.uid]);

  // Tick once a second only while the cooldown is active so we don't burn
  // CPU when there's no countdown to render.
  useEffect(() => {
    const remaining = nextAllowedAt - Date.now();
    if (remaining <= 0) {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    tickRef.current = window.setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [nextAllowedAt]);

  // Webmasters used to be hidden (they're the recipient), but the Slack
  // connection is now established and the team wants every signed-in
  // teammate — including the webmaster — to be able to ping the channel
  // (e.g. webmaster signed in as themselves needs to test the alert path
  // without switching accounts). Server-side rate-limit + role check still
  // apply, so unhiding here doesn't change the security posture.
  if (!profile) return null;

  const senderName = profile.displayName || profile.email?.split("@")[0] || "a teammate";
  const compact = variant === "compact";
  const remainingMs = Math.max(0, nextAllowedAt - Date.now());
  const inCooldown = remainingMs > 0;
  const disabled = !configured || sending || inCooldown;

  const handleClick = async () => {
    if (disabled) return;
    setSending(true);
    try {
      const res = await pingWebmasterSlackAlert({
        agentName: senderName,
        route: location.pathname,
      });
      if (res.ok) {
        const next = res.nextAllowedAt ?? Date.now() + RATE_LIMIT_MS;
        setNextAllowedAt(next);
        writeLocalNextAllowed(profile.uid, next);
        toast({
          title: "Slack channel pinged",
          description: "The webmaster channel has been notified for review.",
        });
      } else if (res.rateLimited && res.nextAllowedAt) {
        // Server's authoritative — sync local state to it.
        setNextAllowedAt(res.nextAllowedAt);
        writeLocalNextAllowed(profile.uid, res.nextAllowedAt);
        toast({
          title: "Cooldown active",
          description: `You can ping again in ${formatCountdown(res.nextAllowedAt - Date.now())}.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Slack alert not sent",
          description: res.error || "Unable to reach the Slack channel. Try again or check Settings.",
          variant: "destructive",
        });
      }
    } finally {
      setSending(false);
    }
  };

  // Label: while in cooldown show the countdown so the agent knows exactly
  // how long until the next press is allowed (reduces the "is it broken?"
  // confusion when the button looks disabled).
  const label = sending
    ? "Pinging…"
    : inCooldown
      ? `Wait ${formatCountdown(remainingMs)}`
      : "Ping Slack";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={handleClick}
          className={["h-7 gap-1.5 text-xs border-primary/40 text-primary hover:bg-primary/10", className].filter(Boolean).join(" ")}
          aria-label={
            inCooldown
              ? `Slack alert cooldown — wait ${formatCountdown(remainingMs)}`
              : "Send Slack alert asking the webmaster to review ConvoHub"
          }
        >
          {inCooldown ? <Clock className="h-3 w-3" /> : <Bell className="h-3 w-3" />}
          {compact ? null : <span>{label}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-[260px]">
        {!configured ? (
          <>Slack webhook isn't set. Ask an admin or webmaster to configure it on Settings.</>
        ) : inCooldown ? (
          <>
            Cooldown active to prevent accidental double-pings.
            <div className="mt-1 text-muted-foreground">
              Next allowed in {formatCountdown(remainingMs)}.
            </div>
          </>
        ) : (
          <>
            Pings the team Slack channel asking the webmaster to review ConvoHub.
            <div className="mt-1 text-muted-foreground">
              No call or text is sent. 10-minute cooldown after each press.
            </div>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
};

export default SlackAlertButton;
