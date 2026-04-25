import React, { useEffect, useMemo, useRef, useState } from "react";
import { Phone, MessageSquare, Clock, Bell, Send, AlertTriangle, ShieldAlert } from "lucide-react";
import { useLocation } from "react-router-dom";
import { collection, orderBy, query } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { subscribeCooldownMin, subscribeSlackAlertConfigured, getLocalSlackAlertConfigured, DEFAULT_COOLDOWN_MIN, type CooldownMinutes } from "@/lib/webmasterCooldown";
import { notifyWebmasterOnContact, pingWebmasterSlackAlert } from "@/lib/notifyWebmaster";

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
const WEBMASTER_NUMBER = import.meta.env.VITE_WEBMASTER_PHONE_E164 || "+17206639706";
const DISPLAY_NUMBER = import.meta.env.VITE_WEBMASTER_PHONE_DISPLAY || "(720) 663-9706";
const LAST_CONTACT_KEY_PREFIX = "convohub.webmasterLastContact.";
const LONG_PRESS_MS = 500;
// Cooldown is configurable via /settings (5/15/30/60 min). This is just the
// initial fallback used before the Firestore subscription delivers a value.

/**
 * SMS templates shown in the Text button's picker. We mirror the starter
 * SMS rows from ConversationTemplates so this list works offline and
 * before the Firestore listener resolves. Custom templates added by the
 * team via the templates collection are merged on top via onSnapshot.
 *
 * Each template body supports {{name}}, {{agent}}, {{company}} variables
 * — we substitute the webmaster as {{name}}, the current user as {{agent}},
 * and "ConvoHub" as {{company}} before launching the SMS composer.
 */
interface SmsTemplate {
  id: string;
  name: string;
  body: string;
  locked?: boolean;
}

const STARTER_SMS_TEMPLATES: SmsTemplate[] = [
  { id: "wm-sms-acknowledge", locked: true, name: "Quick Acknowledgement", body: "Hi {{name}}, this is {{agent}} from {{company}}. Got your message — I'll have a full response within the next few hours. Thanks!" },
  { id: "wm-sms-reminder", locked: true, name: "Appointment Reminder", body: "Hi {{name}}, friendly reminder of your call with {{agent}} tomorrow. Reply YES to confirm or RESCHEDULE to pick a new time." },
  { id: "wm-sms-confirm", locked: true, name: "Meeting Confirmation", body: "Hi {{name}}, confirming our meeting today. I'll send the call link 10 minutes beforehand. See you soon — {{agent}}" },
  { id: "wm-sms-late", locked: true, name: "Running Late", body: "Hi {{name}}, {{agent}} here — running about 5 minutes late to our call. Apologies and thanks for your patience." },
  { id: "wm-sms-doc", locked: true, name: "Document Sent Notice", body: "Hi {{name}}, I just emailed over the document we discussed. Let me know once you've had a chance to review. — {{agent}}" },
  { id: "wm-sms-payment", locked: true, name: "Payment Reminder", body: "Hi {{name}}, a friendly reminder that invoice [#####] is due in 3 days. Reply if you need a copy resent. Thanks — {{company}}" },
  { id: "wm-sms-checkin", locked: true, name: "Thank You / Check-in", body: "Hi {{name}}, just checking in after our recent work together. Anything we can help with? Always glad to hear from you. — {{agent}}" },
];

function applyTemplateVars(body: string, agentName: string): string {
  return body
    .replace(/\{\{name\}\}/g, "Webmaster")
    .replace(/\{\{agent\}\}/g, agentName)
    .replace(/\{\{company\}\}/g, "ConvoHub");
}

/**
 * SMS carrier-limit metrics for the previewed body.
 *
 * GSM-7 (the default 7-bit alphabet) fits 160 chars in a single segment;
 * concatenated segments drop to 153 chars each because 7 bytes are eaten
 * by the User Data Header. If the body contains any non-GSM character
 * (emoji, smart quotes, accented letters, etc.), the carrier transparently
 * upgrades to UCS-2 which only fits 70 chars per single segment / 67 per
 * concatenated segment. We approximate the GSM detection conservatively —
 * anything outside the basic GSM-7 set forces UCS-2.
 *
 * Hard cap: most US carriers reject anything over 10 segments
 * (1530 GSM-7 / 670 UCS-2). We surface a warning at >3 segments and a
 * hard block at >10 segments.
 */
const GSM7_REGEX = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;
const SOFT_SEGMENT_WARN = 3;
const HARD_SEGMENT_LIMIT = 10;
// Most mobile OS sms: handlers truncate the URI at ~2048 chars (iOS Safari
// reportedly truncates earlier on some carriers). We treat 2048 as a hard
// block and 1500 as a soft warning so the agent has a chance to trim.
const SMS_URI_SOFT_LIMIT = 1500;
const SMS_URI_HARD_LIMIT = 2048;
// E.164 max length (incl. leading +) is 15 digits. Anything beyond that
// will be rejected by every carrier we ship to.
const E164_MAX_LENGTH = 16;
const E164_MIN_LENGTH = 8;

interface SmsLimits {
  encoding: "GSM-7" | "UCS-2";
  perSegment: number;
  segments: number;
  charCount: number;
  remainingInSegment: number;
  uriLength: number;
  recipientLength: number;
  recipientValid: boolean;
  level: "ok" | "warn" | "block";
  reason?: string;
  /** Short, actionable next step shown below the reason. */
  recommendation?: string;
}

function computeSmsLimits(body: string, recipient: string = WEBMASTER_NUMBER): SmsLimits {
  const charCount = body.length;
  const isGsm = GSM7_REGEX.test(body);
  const encoding: SmsLimits["encoding"] = isGsm ? "GSM-7" : "UCS-2";

  const singleCap = isGsm ? 160 : 70;
  const concatCap = isGsm ? 153 : 67;

  let segments: number;
  let perSegment: number;
  if (charCount === 0) {
    segments = 1;
    perSegment = singleCap;
  } else if (charCount <= singleCap) {
    segments = 1;
    perSegment = singleCap;
  } else {
    segments = Math.ceil(charCount / concatCap);
    perSegment = concatCap;
  }

  const remainingInSegment = Math.max(0, segments * perSegment - charCount);

  // URL-encoded length matters because the OS sms: handler receives the
  // entire encoded URI, not the raw body. A line of emoji can blow past
  // 2 KB even though the visible body is only ~400 chars.
  const uriBody = encodeURIComponent(body);
  const uriLength = `sms:${recipient}?body=${uriBody}`.length;

  // Recipient sanity — strip any non-digits except a leading + and check
  // it falls within E.164 bounds. We keep the leading + in the count.
  const trimmedRecipient = recipient.trim();
  const recipientLength = trimmedRecipient.length;
  const recipientDigits = trimmedRecipient.replace(/[^\d]/g, "");
  const recipientValid =
    /^\+?\d+$/.test(trimmedRecipient) &&
    recipientLength >= E164_MIN_LENGTH &&
    recipientLength <= E164_MAX_LENGTH &&
    recipientDigits.length >= 7 &&
    recipientDigits.length <= 15;

  let level: SmsLimits["level"] = "ok";
  let reason: string | undefined;
  let recommendation: string | undefined;

  // Recipient problems are always a hard block — there's no point opening
  // the composer if the OS will reject the URI on parse.
  if (!recipientValid) {
    level = "block";
    reason = `Recipient number "${trimmedRecipient}" is not a valid E.164 phone number (${recipientLength} chars).`;
    recommendation = `Use the international format with a leading "+" and ${E164_MIN_LENGTH - 1}–15 digits (e.g. +17206639706).`;
  } else if (uriLength > SMS_URI_HARD_LIMIT) {
    level = "block";
    reason = `URL-encoded SMS link is ${uriLength} chars — exceeds the ${SMS_URI_HARD_LIMIT}-char OS limit, so the composer will silently truncate the body.`;
    recommendation = `Trim the body by ~${Math.ceil((uriLength - SMS_URI_HARD_LIMIT) / 3)} chars (URL encoding inflates emoji/punctuation ~3×).`;
  } else if (segments > HARD_SEGMENT_LIMIT) {
    level = "block";
    reason = `Exceeds the ${HARD_SEGMENT_LIMIT}-segment carrier hard cap (${segments} segments). Most US carriers will reject this message.`;
    recommendation = `Trim to ≤ ${HARD_SEGMENT_LIMIT * perSegment} chars or split into multiple sends.`;
  } else if (uriLength > SMS_URI_SOFT_LIMIT) {
    level = "warn";
    reason = `URL-encoded link is ${uriLength} chars — within ${SMS_URI_HARD_LIMIT - uriLength} of the OS truncation limit.`;
    recommendation = `Some carriers/OS combos truncate around 1.6 KB. Consider trimming or sending a follow-up.`;
  } else if (segments > SOFT_SEGMENT_WARN) {
    level = "warn";
    reason = `${segments} segments will be billed and may arrive out of order or be split by the recipient's carrier.`;
    recommendation = `Aim for ≤ ${SOFT_SEGMENT_WARN * perSegment} chars to fit in ${SOFT_SEGMENT_WARN} segments.`;
  } else if (!isGsm && segments > 1) {
    level = "warn";
    reason = `Non-GSM characters force UCS-2 encoding (${concatCap} chars/segment) — consider removing emoji or smart quotes.`;
    recommendation = `Replace smart quotes (" ") with ASCII (" ') and drop emoji to switch back to GSM-7 (160 chars/segment).`;
  }

  return {
    encoding,
    perSegment,
    segments,
    charCount,
    remainingInSegment,
    uriLength,
    recipientLength,
    recipientValid,
    level,
    reason,
    recommendation,
  };
}
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
  // Track whether the team-wide Slack webhook is configured so we can
  // disable the Slack Alert button (and explain why) when it's empty.
  const [slackConfigured, setSlackConfigured] = useState<boolean>(() => getLocalSlackAlertConfigured());
  useEffect(() => subscribeSlackAlertConfigured(setSlackConfigured), []);
  // Merge custom SMS templates from Firestore on top of the starter list,
  // so any team-managed SMS rows (created on /conversations) also show up
  // in the webmaster Text picker. Errors are swallowed — starters remain.
  useEffect(() => {
    const q = query(collection(db, "templates"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const custom: SmsTemplate[] = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as { name?: string; channel?: string; body?: string }) }))
          .filter((t) => t.channel === "sms" && typeof t.body === "string" && typeof t.name === "string")
          .map((t) => ({ id: t.id, name: t.name as string, body: t.body as string }));
        setSmsTemplates([...STARTER_SMS_TEMPLATES, ...custom]);
      },
      () => setSmsTemplates(STARTER_SMS_TEMPLATES)
    );
    return unsub;
  }, []);
  const [slackSending, setSlackSending] = useState(false);
  const [slackOpen, setSlackOpen] = useState(false);
  const [slackMessage, setSlackMessage] = useState("");
  // SMS template picker state. We hydrate the same starter SMS templates
  // shipped in ConversationTemplates so the menu is never empty even if
  // the Firestore listener hasn't resolved yet (or the user is offline).
  // `smsPreview` holds the template the agent picked but hasn't yet
  // confirmed — when set, the popover swaps from "list" to "preview" mode
  // so they can see the fully substituted body before the OS composer opens.
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsTemplates, setSmsTemplates] = useState<SmsTemplate[]>(STARTER_SMS_TEMPLATES);
  const [smsPreview, setSmsPreview] = useState<{ id: string; name: string; body: string } | null>(null);
  // Agent must explicitly tick the warning checkbox before the composer
  // unlocks when the message exceeds the soft segment threshold. Reset
  // whenever the picked template changes.
  const [oversizeAck, setOversizeAck] = useState(false);
  useEffect(() => {
    setOversizeAck(false);
  }, [smsPreview?.id]);
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

  // Hide the Call/Text shortcuts for the webmaster themselves — dialing
  // their own number is pointless. The standalone SlackAlertButton stays
  // visible for the webmaster on /conversations so they can still verify
  // the alert path while signed in as themselves.
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
      agentUid: userUid ?? "",
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

  // Slack Alert — opens a small popover where the agent can add an optional
  // custom message body before pinging the team channel. The webhook is now
  // managed server-side as a Cloud Functions secret, so the button is
  // always enabled (the callable returns failed-precondition with a clear
  // message if the secret is genuinely missing).
  const handleSlackAlert = async () => {
    if (slackSending) return;
    setSlackSending(true);
    try {
      const res = await pingWebmasterSlackAlert({
        agentName: senderName,
        route: location.pathname,
        message: slackMessage.trim() || undefined,
      });
      toast({
        title: res.ok ? "Slack channel pinged" : res.rateLimited ? "Cooldown active" : "Slack alert not sent",
        description: res.ok
          ? slackMessage.trim()
            ? "Your custom message was sent to the team channel."
            : "The webmaster channel has been notified for review."
          : res.error || "Webhook isn't configured. Ask an admin or webmaster to set it on Settings.",
        variant: res.ok ? undefined : "destructive",
      });
      if (res.ok) {
        setSlackMessage("");
        setSlackOpen(false);
      }
    } finally {
      setSlackSending(false);
    }
  };

  return (
    <div className={["flex flex-col gap-1.5", className].filter(Boolean).join(" ")}>
      {/* Slack Alert — sits above Call/Text. Independent escalation: pings
          the team Slack channel (with an optional custom message) and never
          opens the dialer/composer. Always enabled — server enforces config
          + rate limit. */}
      <Popover open={slackOpen} onOpenChange={(v) => !slackSending && setSlackOpen(v)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={slackSending}
                className="w-full justify-center gap-2 border-primary/40 text-primary hover:bg-primary/10"
                aria-label="Notify the on-call webmaster in Slack"
              >
                <Bell className="h-4 w-4" />
                {compact ? null : <span>{slackSending ? "Sending…" : "Notify webmaster in Slack"}</span>}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[260px]">
            {profile.role === "admin"
              ? "Admin shortcut — pings the on-call webmaster in Slack. Add a custom message or send the default review request."
              : "Agent shortcut — pings the on-call webmaster in Slack. Add a custom message or send the default review request."}
            <div className="mt-1 text-muted-foreground">
              Rate-limited to one ping every 10 minutes per user.
            </div>
          </TooltipContent>
        </Tooltip>
        <PopoverContent
          align="center"
          side="top"
          sideOffset={6}
          collisionPadding={12}
          avoidCollisions
          sticky="always"
          className="w-[min(22rem,calc(100vw-1rem))] max-h-[70vh] overflow-auto p-3 space-y-2"
        >
          <div>
            <p className="text-xs font-medium text-foreground">Send Slack alert</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Optional message body. Leave blank to send the default review request.
            </p>
          </div>
          <Textarea
            value={slackMessage}
            onChange={(e) => setSlackMessage(e.target.value.slice(0, 800))}
            placeholder="Add context for the team (optional)…"
            rows={3}
            className="text-xs resize-none"
            disabled={slackSending}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">{slackMessage.length}/800</span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setSlackOpen(false)}
                disabled={slackSending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={handleSlackAlert}
                disabled={slackSending}
              >
                <Send className="h-3 w-3" />
                {slackSending ? "Sending…" : "Send ping"}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

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

          {/* Text — opens a popover that lists SMS templates instead of
              dispatching the OS composer with the basic context line.
              Picking a template substitutes {{name}}/{{agent}}/{{company}}
              and then launches the OS sms: composer prefilled with the
              chosen body. Forces an explicit choice so we never send a
              hallucinated default body. */}
          <Popover
            open={smsOpen}
            onOpenChange={(open) => {
              setSmsOpen(open);
              if (!open) setSmsPreview(null);
            }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size={compact ? "icon" : "sm"}
                    className={compact ? "h-9 w-9" : "flex-1 justify-center gap-2"}
                    aria-label={`Text webmaster at ${DISPLAY_NUMBER}. Choose an SMS template.`}
                  >
                    <MessageSquare className="h-4 w-4" />
                    {!compact && <span>Text</span>}
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-[220px]">
                Text webmaster · {DISPLAY_NUMBER}
                <div className="mt-1 text-muted-foreground">Pick a template, preview, then send.</div>
              </TooltipContent>
            </Tooltip>
            <PopoverContent
              align="center"
              side="top"
              sideOffset={6}
              collisionPadding={12}
              avoidCollisions
              sticky="always"
              className="w-[min(22rem,calc(100vw-1rem))] max-h-[80vh] overflow-auto p-0"
            >
              {smsPreview ? (
                // Preview step — shows the fully substituted body before
                // we launch the device SMS composer. Forces the agent to
                // visually confirm the variable substitution worked, AND
                // surfaces a hard block + soft warning when the body
                // exceeds typical carrier segment limits.
                (() => {
                  const limits = computeSmsLimits(smsPreview.body);
                  const blocked = limits.level === "block";
                  const warn = limits.level === "warn";
                  const requireAck = warn || blocked;
                  const composerDisabled = blocked || (requireAck && !oversizeAck);
                  return (
                    <div className="p-3 space-y-3">
                      <div>
                        <p className="text-xs font-medium text-foreground">Preview SMS</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Template: <span className="text-foreground">{smsPreview.name}</span> · To: {DISPLAY_NUMBER}
                        </p>
                      </div>
                      <div className="rounded-md border border-border bg-muted/40 p-3">
                        <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                          {smsPreview.body}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                          <span>{limits.charCount} chars</span>
                          <span>·</span>
                          <span className={limits.segments > SOFT_SEGMENT_WARN ? "font-semibold text-warning" : ""}>
                            {limits.segments} segment{limits.segments === 1 ? "" : "s"}
                          </span>
                          <span>·</span>
                          <span>{limits.encoding}</span>
                          <span>·</span>
                          <span>{limits.perSegment}/seg</span>
                          <span>·</span>
                          <span
                            className={
                              limits.uriLength > SMS_URI_HARD_LIMIT
                                ? "font-semibold text-destructive"
                                : limits.uriLength > SMS_URI_SOFT_LIMIT
                                ? "font-semibold text-warning"
                                : ""
                            }
                            title="URL-encoded sms: URI length"
                          >
                            URI {limits.uriLength}/{SMS_URI_HARD_LIMIT}
                          </span>
                          <span>·</span>
                          <span
                            className={!limits.recipientValid ? "font-semibold text-destructive" : ""}
                            title="Recipient phone number length (E.164 max 16 chars)"
                          >
                            To {limits.recipientLength}ch
                          </span>
                        </div>
                      </div>

                      {/* Carrier-limit advisory. Three possible states:
                          - block: hard cap exceeded, composer never unlocks.
                          - warn: requires explicit checkbox confirmation.
                          - ok: hidden. */}
                      {blocked && (
                        <div
                          role="alert"
                          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-[11px] text-destructive"
                        >
                          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <div>
                            <p className="font-semibold">Composer blocked — carrier could truncate</p>
                            <p className="mt-0.5 text-destructive/90">{limits.reason}</p>
                            {limits.recommendation && (
                              <p className="mt-1 text-destructive/80">
                                <span className="font-medium">Fix:</span> {limits.recommendation}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                      {warn && !blocked && (
                        <div
                          role="alert"
                          className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-[11px] text-warning-foreground"
                        >
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                            <div>
                              <p className="font-semibold">Exceeds typical carrier limit</p>
                              <p className="mt-0.5">{limits.reason}</p>
                              {limits.recommendation && (
                                <p className="mt-1 text-foreground/80">
                                  <span className="font-medium">Suggestion:</span> {limits.recommendation}
                                </p>
                              )}
                            </div>
                          </div>
                          <label className="flex items-start gap-2 cursor-pointer pl-5">
                            <Checkbox
                              checked={oversizeAck}
                              onCheckedChange={(v) => setOversizeAck(v === true)}
                              aria-label="I understand the message will be sent in multiple segments"
                              className="mt-0.5"
                            />
                            <span className="text-foreground">
                              I understand this may be split, truncated, or billed as {limits.segments} segments and want to send anyway.
                            </span>
                          </label>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setSmsPreview(null)}
                        >
                          ← Pick another
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          disabled={composerDisabled}
                          onClick={() => {
                            if (composerDisabled) return;
                            const href = `sms:${WEBMASTER_NUMBER}?body=${encodeURIComponent(smsPreview.body)}`;
                            const a = document.createElement("a");
                            a.href = href;
                            a.rel = "noopener";
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            recordContact("text");
                            toast({
                              title: `SMS template sent: ${smsPreview.name}`,
                              description: warn
                                ? `Sent in ${limits.segments} segments. Your messaging app should open with the message prefilled.`
                                : "Your messaging app should open with the message prefilled.",
                            });
                            setSmsPreview(null);
                            setSmsOpen(false);
                            setOversizeAck(false);
                          }}
                        >
                          <Send className="h-3 w-3" />
                          {blocked ? "Blocked" : "Open composer"}
                        </Button>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <>
                  <div className="border-b border-border p-3">
                    <p className="text-xs font-medium text-foreground">Choose an SMS template</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Variables auto-fill: {"{{name}}"} → Webmaster, {"{{agent}}"} → you, {"{{company}}"} → ConvoHub.
                    </p>
                  </div>
                  <div className="max-h-72 overflow-auto p-2">
                    {smsTemplates.map((tpl) => {
                      const filled = applyTemplateVars(tpl.body, senderName);
                      return (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => setSmsPreview({ id: tpl.id, name: tpl.name, body: filled })}
                          className="block w-full rounded-md border border-transparent p-2 text-left transition-colors hover:border-border hover:bg-accent/40"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-foreground">{tpl.name}</span>
                            {tpl.locked && (
                              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">Starter</span>
                            )}
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{filled}</p>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </PopoverContent>
          </Popover>
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
                // Open the template picker rather than firing a bare SMS —
                // keeps the "no hallucinated default body" rule.
                setConfirmChannel(null);
                setSmsOpen(true);
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
