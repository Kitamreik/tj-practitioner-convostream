import React, { useEffect, useRef, useState } from "react";
import { Bell, Clock, Send } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
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
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
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

  if (!profile) return null;

  const senderName = profile.displayName || profile.email?.split("@")[0] || "a teammate";
  const compact = variant === "compact";
  const remainingMs = Math.max(0, nextAllowedAt - Date.now());
  const inCooldown = remainingMs > 0;
  // The webhook is now provisioned server-side as a Cloud Functions secret —
  // we no longer require the legacy `appSettings/slackAlertStatus.configured`
  // mirror to enable the button. The callable returns `failed-precondition`
  // if the secret is genuinely missing, which we surface as a toast.
  const disabled = sending || inCooldown;

  const handleSend = async () => {
    if (disabled) return;
    setSending(true);
    try {
      const res = await pingWebmasterSlackAlert({
        agentName: senderName,
        route: location.pathname,
        message: message.trim() || undefined,
      });
      if (res.ok) {
        const next = res.nextAllowedAt ?? Date.now() + RATE_LIMIT_MS;
        setNextAllowedAt(next);
        writeLocalNextAllowed(profile.uid, next);
        setMessage("");
        setOpen(false);
        toast({
          title: "Slack channel pinged",
          description: message.trim()
            ? "Your custom message was sent to the team channel."
            : "The webmaster channel has been notified for review.",
        });
      } else if (res.rateLimited && res.nextAllowedAt) {
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

  const label = sending
    ? "Pinging…"
    : inCooldown
      ? `Wait ${formatCountdown(remainingMs)}`
      : "Ping Slack";

  return (
    <Popover open={open} onOpenChange={(v) => !sending && setOpen(v)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              className={["h-7 gap-1.5 text-xs border-primary/40 text-primary hover:bg-primary/10", className].filter(Boolean).join(" ")}
              aria-label={
                inCooldown
                  ? `Slack alert cooldown — wait ${formatCountdown(remainingMs)}`
                  : "Open Slack alert composer"
              }
            >
              {inCooldown ? <Clock className="h-3 w-3" /> : <Bell className="h-3 w-3" />}
              {compact ? null : <span>{label}</span>}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[260px]">
          {inCooldown ? (
            <>
              Cooldown active to prevent accidental double-pings.
              <div className="mt-1 text-muted-foreground">
                Next allowed in {formatCountdown(remainingMs)}.
              </div>
            </>
          ) : (
            <>
              Pings the team Slack channel. Add a custom message or send the default review request.
              {!configured && (
                <div className="mt-1 text-muted-foreground">
                  Webhook is managed server-side — the function will tell you if it's not configured.
                </div>
              )}
            </>
          )}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-3 space-y-2">
        <div>
          <p className="text-xs font-medium text-foreground">Send Slack alert</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Optional message body. Leave blank to send the default review request.
          </p>
        </div>
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 800))}
          placeholder="Add context for the team (optional)…"
          rows={3}
          className="text-xs resize-none"
          disabled={sending}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">{message.length}/800</span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setOpen(false)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={handleSend}
              disabled={disabled}
            >
              <Send className="h-3 w-3" />
              {sending ? "Sending…" : "Send ping"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default SlackAlertButton;
