import React from "react";
import { Shield, ShieldCheck, User as UserIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth, type UserRole } from "@/contexts/AuthContext";

/**
 * Compact, consistent role chip rendered on every page header that exposes
 * role-aware controls (Home, Conversations, Agent Logs, Settings). Hovering
 * surfaces a one-line tooltip explaining what the current role can do, so
 * the support UI mock stays self-documenting across roles.
 */
const COPY: Record<UserRole, { label: string; tooltip: string; tone: string; Icon: React.ComponentType<{ className?: string }> }> = {
  webmaster: {
    label: "Webmaster",
    tooltip: "Full access — promote agents, review escalations, and edit team integrations.",
    tone: "border-primary/40 bg-primary/10 text-primary",
    Icon: ShieldCheck,
  },
  admin: {
    label: "Admin",
    tooltip: "Manage agents and conversations. Request escalation for Integrations / Analytics / Gmail.",
    tone: "border-accent/40 bg-accent/10 text-accent-foreground",
    Icon: Shield,
  },
  agent: {
    label: "Agent",
    tooltip: "Handle your assigned conversations. Ping the webmaster for review or assistance.",
    tone: "border-border bg-muted text-foreground",
    Icon: UserIcon,
  },
};

interface Props {
  className?: string;
}

const RoleBadge: React.FC<Props> = ({ className }) => {
  const { profile } = useAuth();
  if (!profile) return null;
  const meta = COPY[profile.role];
  const Icon = meta.Icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={["gap-1 text-[10px] uppercase tracking-wider", meta.tone, className]
            .filter(Boolean)
            .join(" ")}
          aria-label={`Signed in as ${meta.label}`}
        >
          <Icon className="h-3 w-3" />
          {meta.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[260px] text-xs">
        {meta.tooltip}
      </TooltipContent>
    </Tooltip>
  );
};

export default RoleBadge;
