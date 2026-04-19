/**
 * Tiny pill rendered next to a person's name when they have Support access.
 * Lets the team see at a glance who can moderate Team Chat and who lands on
 * the Support call-center home. Pure presentational — callers decide whether
 * to show it via `useSupportUsers()` lookups.
 */
import React from "react";
import { LifeBuoy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface SupportBadgeProps {
  /** Visual size: "xs" matches inline chips next to names; "sm" for tables. */
  size?: "xs" | "sm";
  /** Hide the icon when space is very tight (e.g. inside a status chip). */
  iconOnly?: boolean;
  className?: string;
}

export const SupportBadge: React.FC<SupportBadgeProps> = ({
  size = "xs",
  iconOnly = false,
  className,
}) => {
  const sizeClasses =
    size === "sm"
      ? "text-[10px] gap-1 px-1.5 py-0.5"
      : "text-[9px] gap-0.5 px-1 py-0 h-4 leading-none";
  const iconSize = size === "sm" ? "h-2.5 w-2.5" : "h-2 w-2";
  return (
    <Badge
      variant="outline"
      title="Support access — can moderate Team Chat"
      aria-label="Support access"
      className={cn(
        "border-primary/40 bg-primary/5 text-primary font-medium uppercase tracking-wide",
        sizeClasses,
        className
      )}
    >
      <LifeBuoy className={iconSize} />
      {!iconOnly && <span>Support</span>}
    </Badge>
  );
};
