import React, { useEffect, useRef, useState } from "react";
import { Bell, Clock } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { pingWebmasterSlackAlert } from "@/lib/notifyWebmaster";

const RATE_LIMIT_MS = 10 * 60 * 1000;
const LOCAL_KEY_NEXT_ALLOWED_PREFIX = "convohub.slackAlertNextAllowed.";

interface Props {
  className?: string;
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
  const [sending, setSending] = useState(false);
  const [nextAllowedAt, setNextAllowedAt] = useState<number>(() => readLocalNextAllowed(profile?.uid));
  const [, setNowTick] = useState(0);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    setNextAllowedAt(readLocalNextAllowed(profile?.uid));
  }, [profile?.uid]);

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

  const compact = variant === "compact";
  const remainingMs = Math.max(0, nextAllowedAt - Date.now());
  const inCooldown = remainingMs > 0;
  const disabled = sending || inCooldown;

  const handleSend = async () => {
    if (disabled) return;
    setSending(true);
    try {
      const res = await pingWebmasterSlackAlert({ route: location.pathname });
      if (res.ok) {
        const next = res.nextAllowedAt ?? Date.now() + RATE_LIMIT_MS;
        setNextAllowedAt(next);
        writeLocalNextAllowed(profile.uid, next);
        toast({ title: "Slack channel pinged", description: "An alert was sent to the team channel." });
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

  const label = sending ? "Pinging…" : inCooldown ? `Wait ${formatCountdown(remainingMs)}` : "Ping Slack";
  const description = inCooldown
    ? `Cooldown active. Next allowed in ${formatCountdown(remainingMs)}.`
    : profile.role === "webmaster"
      ? "Send a bare Slack alert to the team channel for testing."
      : "Send a bare Slack alert to the team channel for webmaster review.";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={handleSend}
          className={["h-7 gap-1.5 text-xs border-primary/40 text-primary hover:bg-primary/10", className].filter(Boolean).join(" ")}
          aria-label={description}
        >
          {inCooldown ? <Clock className="h-3 w-3" /> : <Bell className="h-3 w-3" />}
          {compact ? null : <span>{label}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-xs">
        {description}
        <div className="mt-1 text-muted-foreground">Rate-limited to one ping every 10 minutes per user.</div>
      </TooltipContent>
    </Tooltip>
  );
};

export default SlackAlertButton;
