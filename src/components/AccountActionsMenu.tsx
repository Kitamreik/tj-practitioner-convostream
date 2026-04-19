import React from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * One row of actions in a per-account / per-row toolbar.
 *
 * Renders as inline Buttons on desktop and collapses to a single ⋯ overflow
 * menu on mobile so a long Promote/Demote/Grant/Revoke/Delete row doesn't
 * wrap or push content offscreen on small viewports.
 *
 * Each action that opens a confirmation dialog (e.g. Delete) can render a
 * custom `wrapper` so its trigger remains an `AlertDialogTrigger` instead
 * of a plain button. On mobile, wrapper-style actions render as a normal
 * `DropdownMenuItem` with their `onSelect` invoking the click handler so the
 * existing dialog still opens — the wrapper is desktop-only.
 */
export interface RowAction {
  /** Stable id used as the React key. */
  key: string;
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  /** Show a destructive style on the menu item / button. */
  destructive?: boolean;
  /** Hide the action without removing it from the array (keeps order stable). */
  hidden?: boolean;
  disabled?: boolean;
  /**
   * Optional desktop-only wrapper, e.g. an `<AlertDialog><AlertDialogTrigger asChild>…</…></…>`.
   * The function receives the desktop Button so the trigger semantics work
   * correctly. Mobile collapses to a plain `DropdownMenuItem` that fires
   * `onClick` (so any AlertDialog can be controlled via state from the parent
   * if needed). For the simple delete case, the parent already has the
   * AlertDialog mounted separately — the menu item just toggles its open
   * state via `onClick`.
   */
  desktopWrapper?: (button: React.ReactNode) => React.ReactNode;
}

interface AccountActionsMenuProps {
  actions: RowAction[];
  /** Tailwind classes applied to the desktop button row. */
  className?: string;
  /** Trigger button aria-label (mobile). */
  triggerLabel?: string;
}

export const AccountActionsMenu: React.FC<AccountActionsMenuProps> = ({
  actions,
  className,
  triggerLabel = "More actions",
}) => {
  const isMobile = useIsMobile();
  const visible = actions.filter((a) => !a.hidden);
  if (visible.length === 0) return null;

  if (isMobile) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 flex-shrink-0"
            aria-label={triggerLabel}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {visible.map((a, idx) => (
            <React.Fragment key={a.key}>
              {idx > 0 && a.destructive && !visible[idx - 1].destructive && (
                <DropdownMenuSeparator />
              )}
              <DropdownMenuItem
                disabled={a.disabled}
                onSelect={(e) => {
                  // Prevent Radix from auto-closing before our handler runs;
                  // we close after the click resolves.
                  e.preventDefault();
                  a.onClick?.();
                }}
                className={cn(
                  "gap-2",
                  a.destructive && "text-destructive focus:text-destructive"
                )}
              >
                {a.icon}
                <span>{a.label}</span>
              </DropdownMenuItem>
            </React.Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Desktop: inline button row.
  return (
    <div className={cn("flex flex-shrink-0 gap-2 flex-wrap", className)}>
      {visible.map((a) => {
        const btn = (
          <Button
            key={a.key}
            size="sm"
            variant="outline"
            className={cn("gap-1", a.destructive && "text-destructive hover:text-destructive")}
            disabled={a.disabled}
            onClick={a.onClick}
          >
            {a.icon}
            {a.label}
          </Button>
        );
        return (
          <React.Fragment key={a.key}>
            {a.desktopWrapper ? a.desktopWrapper(btn) : btn}
          </React.Fragment>
        );
      })}
    </div>
  );
};
