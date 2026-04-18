import React, { useEffect, useRef, useState } from "react";
import { Phone, MessageSquare, Clock } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { subscribeCooldownMin, DEFAULT_COOLDOWN_MIN, type CooldownMinutes } from "@/lib/webmasterCooldown";
import { notifyWebmasterOnContact } from "@/lib/notifyWebmaster";

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
 * - "Last contacted X min ago" is persisted to
 *   `users/{uid}.lastWebmasterContact` so the hint follows the agent across
 *   devices, with a localStorage mirror as an offline fallback.
 * - 15-minute soft cooldown: within that window the two buttons are
 *   replaced with a single "Just contacted — call again?" button that opens
 *   a confirm dialog so an anxious agent can't accidentally double-text.
 *
 * Number is hard-coded per ops decision — change in one place if it moves.
 */
const WEBMASTER_NUMBER = "+17206639706"; // (720) 663-9706
const DISPLAY_NUMBER = "(720) 663-9706";
const LAST_CONTACT_KEY_PREFIX = "convohub.webmasterLastContact.";
const LONG_PRESS_MS = 500;
// Cooldown is configurable via /settings (5/15/30/60 min). This is just the
// initial fallback used before the Firestore subscription delivers a value.


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
  // Tick every 30s so the relative label and cooldown gate stay fresh
  // without rerendering the whole tree on every frame.
  const [, setNowTick] = useState(0);
  // Confirm dialog for the soft cooldown. We stash which channel
  // (call/text) the user picked so we can launch it after they confirm.
  const [confirmChannel, setConfirmChannel] = useState<"call" | "text" | null>(null);
  // Live cooldown duration (minutes) — synced from appSettings/webmasterContact.
  const [cooldownMin, setCooldownMin] = useState<CooldownMinutes>(DEFAULT_COOLDOWN_MIN);
  useEffect(() => subscribeCooldownMin(setCooldownMin), []);
  const cooldownMs = cooldownMin * 60 * 1000;

  const lastKey = profile?.uid ? LAST_CONTACT_KEY_PREFIX + profile.uid : null;
  const userUid = profile?.uid ?? null;

  // 1) Hydrate from localStorage immediately (offline fallback / first
  //    paint), then 2) subscribe to Firestore so the value follows the
  //    agent across devices.
  useEffect(() => {
    if (!lastKey) {
      setLastContactMs(null);
      return;
    }
    try {
      const raw = localStorage.getItem(lastKey);
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n)) setLastContactMs(n);
    } catch {
      /* private mode — silent */
    }
  }, [lastKey]);

  useEffect(() => {
    if (!userUid) return;
    const unsub = onSnapshot(
      doc(db, "users", userUid),
      (snap) => {
        const data = snap.data() as { lastWebmasterContact?: { toMillis?: () => number } | number } | undefined;
        const raw = data?.lastWebmasterContact;
        let ms: number | null = null;
        if (raw && typeof (raw as any).toMillis === "function") {
          ms = (raw as any).toMillis();
        } else if (typeof raw === "number") {
          ms = raw;
        }
        if (ms !== null) {
          setLastContactMs((prev) => (prev && prev > ms! ? prev : ms));
          if (lastKey) {
            try { localStorage.setItem(lastKey, String(ms)); } catch { /* noop */ }
          }
        }
      },
      () => {
        /* permission/network error — silently keep the local value */
      }
    );
    return unsub;
  }, [userUid, lastKey]);

  useEffect(() => {
    // Tick frequently enough to flip out of the cooldown right when the
    // 15-minute window elapses (worst-case 30s late, which is acceptable).
    const id = window.setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

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
  const inCooldown = lastContactMs !== null && Date.now() - lastContactMs < cooldownMs;

  const recordContact = (channel: "call" | "text") => {
    const now = Date.now();
    setLastContactMs(now);
    if (lastKey) {
      try { localStorage.setItem(lastKey, String(now)); } catch { /* private mode */ }
    }
    if (userUid) {
      // Merge so we never trample the rest of the user profile.
      setDoc(
        doc(db, "users", userUid),
        { lastWebmasterContact: serverTimestamp() },
        { merge: true }
      ).catch((err) => {
        // Never block the UI on telemetry — the local mirror still works.
        console.warn("Failed to persist lastWebmasterContact:", err);
      });
    }
    // Fan out to every webmaster's bell so they see the heads-up even if
    // they miss the call/text. Best-effort — never block the OS hand-off.
    notifyWebmasterOnContact({
      channel,
      agentName: senderName,
      route: location.pathname,
    }).catch((err) => {
      console.warn("Failed to notify webmaster:", err);
    });
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
  const guardClick = (channel: "call" | "text") => (e: React.MouseEvent) => {
    if (longPressFiredRef.current) {
      e.preventDefault();
      longPressFiredRef.current = false;
      return;
    }
    recordContact(channel);
  };

  // Programmatically open a tel:/sms: link from the confirm dialog.
  // Using <a>.click() preserves the OS hand-off (vs window.location which
  // some mobile browsers block when not initiated from a user gesture in
  // the original DOM tree).
  const launchChannel = (channel: "call" | "text") => {
    const href = channel === "call" ? telHref : smsHref;
    const a = document.createElement("a");
    a.href = href;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    recordContact(channel);
  };

  return (
    <div className={["flex flex-col gap-1.5", className].filter(Boolean).join(" ")}>
      {inCooldown ? (
        // Cooldown view: one button + confirm dialog. Mirrors the layout
        // height of the two-button row so the sidebar/sheet doesn't jump.
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-center gap-2 border-warning/40 text-warning-foreground hover:bg-warning/10"
              onClick={() => setConfirmChannel("call")}
            >
              <Clock className="h-4 w-4" />
              Just contacted — call again?
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[240px]">
            You contacted the webmaster {formatRelative(lastContactMs!)}. Tap to confirm a second attempt.
          </TooltipContent>
        </Tooltip>
      ) : (
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
                  onClick={guardClick("call")}
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
                  onClick={guardClick("text")}
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
      )}

      {/* Last-contacted hint — only renders once an agent has actually
          tapped one of the buttons. Persisted to Firestore so it follows
          the agent across devices. */}
      {lastContactMs && (
        <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-2.5 w-2.5" />
          Last contacted webmaster {formatRelative(lastContactMs)}
        </p>
      )}

      {/* Cooldown confirm — one dialog handles both channels, the agent
          picks Call or Text from inside it so a single tap is never
          enough to double-contact during the 15-min window. */}
      <AlertDialog
        open={confirmChannel !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmChannel(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You just contacted the webmaster — call again?</AlertDialogTitle>
            <AlertDialogDescription>
              You reached out {lastContactMs ? formatRelative(lastContactMs) : "moments ago"}. To
              prevent accidental double-texts during an incident, confirm how you'd like to follow up.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialogCancel className="sm:mr-auto">Not now</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                launchChannel("text");
                setConfirmChannel(null);
              }}
              className="gap-2"
            >
              <MessageSquare className="h-4 w-4" />
              Text again
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                launchChannel("call");
                setConfirmChannel(null);
              }}
              className="gap-2"
            >
              <Phone className="h-4 w-4" />
              Call again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default WebmasterContactButtons;
