import React, { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import {
  getLocalSlackWebhookUrl,
  subscribeSlackWebhookUrl,
} from "@/lib/webmasterCooldown";
import { pingWebmasterSlackAlert } from "@/lib/notifyWebmaster";

/**
 * SlackAlertButton — standalone "ping the team Slack channel" action.
 *
 * Extracted from WebmasterContactButtons so it can sit next to other
 * top-of-thread actions (e.g. Elevate to webmaster) without dragging the
 * call/text/cooldown UI along. No phone hand-off, no contact record, no
 * cooldown gate — purely an escalation ping with the fixed review message.
 *
 * Hidden for the webmaster role (they're the recipient). Disabled when no
 * Slack webhook is configured on /settings.
 */
interface Props {
  className?: string;
  /** "compact" hides the label and shows just the bell icon. */
  variant?: "compact" | "full";
}

const SlackAlertButton: React.FC<Props> = ({ className, variant = "full" }) => {
  const { profile } = useAuth();
  const location = useLocation();
  const [slackWebhook, setSlackWebhook] = useState<string>(() => getLocalSlackWebhookUrl());
  const [sending, setSending] = useState(false);

  useEffect(() => subscribeSlackWebhookUrl(setSlackWebhook), []);

  if (!profile || profile.role === "webmaster") return null;

  const webhookConfigured = !!slackWebhook && slackWebhook.startsWith("https://hooks.slack.com/");
  const senderName = profile.displayName || profile.email?.split("@")[0] || "a teammate";
  const compact = variant === "compact";

  const handleClick = async () => {
    if (!webhookConfigured || sending) return;
    setSending(true);
    try {
      const ok = await pingWebmasterSlackAlert({
        agentName: senderName,
        route: location.pathname,
      });
      toast({
        title: ok ? "Slack channel pinged" : "Slack alert not sent",
        description: ok
          ? "The webmaster channel has been notified for review."
          : "Webhook isn't configured. Ask the webmaster to set it on Settings.",
        variant: ok ? undefined : "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!webhookConfigured || sending}
          onClick={handleClick}
          className={["h-7 gap-1.5 text-xs border-primary/40 text-primary hover:bg-primary/10", className].filter(Boolean).join(" ")}
          aria-label="Send Slack alert asking the webmaster to review ConvoHub"
        >
          <Bell className="h-3 w-3" />
          {compact ? null : <span>{sending ? "Pinging…" : "Ping Slack"}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-[260px]">
        {webhookConfigured ? (
          <>
            Pings the team Slack channel asking the webmaster to review ConvoHub.
            <div className="mt-1 text-muted-foreground">No call or text is sent.</div>
          </>
        ) : (
          <>Slack webhook isn't set. Ask the webmaster to configure it on Settings.</>
        )}
      </TooltipContent>
    </Tooltip>
  );
};

export default SlackAlertButton;
