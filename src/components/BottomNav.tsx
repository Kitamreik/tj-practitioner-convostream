import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { MessageCircle, Users, Bell, BarChart3, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { Plug, Shield, Mail, Settings as SettingsIcon, LogOut, Moon, Sun, Eye, Archive as ArchiveIcon, ScrollText, Megaphone, FileVideo, KeyRound } from "lucide-react";
import WebmasterContactButtons from "@/components/WebmasterContactButtons";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getActiveCount, subscribeRecordings } from "@/lib/fileRecordings";
import { getBoolPref, subscribeBoolPref } from "@/lib/userPrefs";
import { useIntegrationsHealth } from "@/hooks/useIntegrationsHealth";

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path: string;
  badgeKey?: string;
  webmasterOrEscalated?: boolean;
  roles?: ("agent" | "admin" | "webmaster")[];
}

const chatsItem: NavItem = { label: "Chats", icon: <MessageCircle className="h-5 w-5" />, path: "/", badgeKey: "conversations" };
const alertsItem: NavItem = { label: "Alerts", icon: <Bell className="h-5 w-5" />, path: "/notifications", badgeKey: "notifications" };
const archiveItem: NavItem = { label: "Archive", icon: <ArchiveIcon className="h-5 w-5" />, path: "/archive" };
const settingsItem: NavItem = { label: "Settings", icon: <SettingsIcon className="h-5 w-5" />, path: "/settings" };

// Trimmed: Icon Key, Analytics, and Agents removed from the More sheet
// per product direction. Webmaster-gated utility entries remain.
const moreItems: NavItem[] = [
  { label: "Staff Updates", icon: <Megaphone className="h-5 w-5" />, path: "/staff-updates", badgeKey: "staff" },
  { label: "Agent Logs", icon: <ScrollText className="h-5 w-5" />, path: "/agent-logs" },
  { label: "File Recordings", icon: <FileVideo className="h-5 w-5" />, path: "/file-recordings", badgeKey: "recordings" },
  { label: "Integrations", icon: <Plug className="h-5 w-5" />, path: "/integrations", webmasterOrEscalated: true },
  { label: "Audit Logs", icon: <Shield className="h-5 w-5" />, path: "/audit", roles: ["webmaster"] },
  { label: "Gmail API", icon: <Mail className="h-5 w-5" />, path: "/gmail", webmasterOrEscalated: true },
];

const BottomNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [unread, setUnread] = useState(0);
  const [notifs, setNotifs] = useState(0);
  const [staffActive, setStaffActive] = useState(0);
  const [recordingsActive, setRecordingsActive] = useState(() => getActiveCount());
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "conversations"), where("unread", "==", true));
    const unsub = onSnapshot(q, (snap) => setUnread(snap.size), () => setUnread(2));
    return unsub;
  }, []);

  const userUid = profile?.uid;
  useEffect(() => {
    if (!userUid) {
      setNotifs(0);
      return;
    }
    const q = query(
      collection(db, "users", userUid, "notifications"),
      where("read", "==", false)
    );
    const unsub = onSnapshot(q, (snap) => setNotifs(snap.size), () => setNotifs(0));
    return unsub;
  }, [userUid]);

  useEffect(() => {
    const q = query(collection(db, "staff_updates"), where("status", "in", ["ongoing", "maintenance"]));
    const unsub = onSnapshot(q, (s) => setStaffActive(s.size), () => setStaffActive(0));
    return unsub;
  }, []);

  useEffect(() => {
    setRecordingsActive(getActiveCount());
    return subscribeRecordings(() => setRecordingsActive(getActiveCount()));
  }, []);

  // "Mute team broadcasts" preference (set on /notifications). When ON we
  // overlay a small indicator dot on the bell so the user remembers that
  // Staff Updates / File Recordings are hidden.
  const [broadcastsMuted, setBroadcastsMuted] = useState(false);
  useEffect(() => {
    setBroadcastsMuted(getBoolPref(userUid, "notifications.muteBroadcasts", false));
    return subscribeBoolPref(userUid, "notifications.muteBroadcasts", setBroadcastsMuted);
  }, [userUid]);

  // Webmaster-only: subscribe to the latest scheduled/manual integrations
  // health check so we can render a red dot on the More button (and inside
  // the sheet on the Integrations row) when any provider is failing.
  const isWebmaster = profile?.role === "webmaster";
  const integrationsHealth = useIntegrationsHealth(isWebmaster);
  const integrationsFailing = !!integrationsHealth?.anyFailing;
  const lastCheckedLabel = integrationsHealth?.checkedAtMs
    ? new Date(integrationsHealth.checkedAtMs).toLocaleString()
    : "Not yet run";

  const getBadge = (item: NavItem) => {
    if (item.badgeKey === "conversations") return unread;
    if (item.badgeKey === "notifications") return notifs;
    if (item.badgeKey === "staff") return staffActive;
    if (item.badgeKey === "recordings") return recordingsActive;
    return 0;
  };

  const go = (path: string) => {
    navigate(path);
    setMoreOpen(false);
  };

  const escalated = profile?.role === "webmaster" || profile?.escalatedAccess === true;
  // Non-escalated admins lose the Stats slot; surface Archive instead so the bar stays useful.
  const primaryItems: NavItem[] = escalated
    ? [chatsItem, peopleItem, alertsItem, statsItem]
    : [chatsItem, peopleItem, alertsItem, { label: "Archive", icon: <ArchiveIcon className="h-5 w-5" />, path: "/archive" }];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-stretch border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
      {primaryItems.map((item) => {
        const active = location.pathname === item.path;
        const badge = getBadge(item);
        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={cn(
              "relative flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors",
              active ? "text-primary" : "text-muted-foreground"
            )}
            aria-label={item.label}
          >
            <div className="relative">
              {item.icon}
              {badge > 0 && (
                <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
              {item.badgeKey === "notifications" && broadcastsMuted && badge === 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => {
                        // Stop the parent nav button from also firing — we
                        // navigate with a hash so the target scrolls into view.
                        e.stopPropagation();
                        navigate("/notifications#mute-broadcasts-toggle");
                      }}
                      className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-warning ring-2 ring-background"
                      aria-label="Team broadcasts muted — tap to manage"
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    Team broadcasts muted — tap to manage
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <span>{item.label}</span>
          </button>
        );
      })}

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetTrigger asChild>
          <button
            className="relative flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium text-muted-foreground"
            aria-label="More"
          >
            <div className="relative">
              <Menu className="h-5 w-5" />
              {(staffActive + recordingsActive) > 0 && (
                <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
                  {(staffActive + recordingsActive) > 9 ? "9+" : staffActive + recordingsActive}
                </span>
              )}
              {/* Webmaster-only red dot when an integration failed its
                  most recent health check. Sits opposite the count badge
                  so both can coexist without overlap. */}
              {integrationsFailing && (
                <span
                  className="absolute -left-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-background animate-pulse"
                  aria-label={`Integration issue: ${integrationsHealth?.failingProviders.join(", ")}`}
                  title={`Integration issue — ${integrationsHealth?.failingProviders.join(", ") || "see /integrations"} (last checked ${lastCheckedLabel})`}
                />
              )}
            </div>
            <span>More</span>
          </button>
        </SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-2 py-4">
            {moreItems
              .filter((i) => {
                if (i.roles && !(profile && i.roles.includes(profile.role))) return false;
                if (i.webmasterOrEscalated && !escalated) return false;
                return true;
              })
              .map((item) => {
                const badge = getBadge(item);
                const isRed = item.badgeKey === "staff" || item.badgeKey === "recordings";
                const showHealthDot = item.path === "/integrations" && integrationsFailing;
                return (
                  <button
                    key={item.path}
                    onClick={() => go(item.path)}
                    className={cn(
                      "relative flex items-center gap-3 rounded-lg border border-border p-3 text-sm font-medium transition-colors",
                      location.pathname === item.path ? "bg-accent" : "hover:bg-muted/50"
                    )}
                  >
                    <span className="relative inline-flex">
                      {item.icon}
                      {showHealthDot && (
                        <span
                          className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-destructive ring-2 ring-background animate-pulse"
                          aria-label="Integration issue"
                        />
                      )}
                    </span>
                    <span className="flex-1 text-left">
                      {item.label}
                      {showHealthDot && (
                        <span className="ml-1 text-[10px] text-destructive font-semibold">• issue</span>
                      )}
                    </span>
                    {badge > 0 && (
                      <span className={cn(
                        "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
                        isRed ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"
                      )}>
                        {badge > 9 ? "9+" : badge}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {profile?.displayName?.charAt(0)?.toUpperCase() || "U"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{profile?.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">{profile?.email}</p>
              </div>
            </div>
            {/* One-tap call/text the on-call webmaster — hidden for the
                webmaster role (component handles gating). */}
            <WebmasterContactButtons className="w-full" />
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-3"
              onClick={toggleTheme}
              aria-label={`Switch theme — current: ${theme}. Cycles light → dark → coder.`}
            >
              {theme === "light" ? (
                <Moon className="h-4 w-4" />
              ) : theme === "dark" ? (
                <Eye className="h-4 w-4" />
              ) : (
                <Sun className="h-4 w-4" />
              )}
              {theme === "light" ? "Dark Mode" : theme === "dark" ? "Coder Mode" : "Light Mode"}
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start gap-3 text-destructive" onClick={signOut}>
              <LogOut className="h-4 w-4" /> Sign Out
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
};

export default BottomNav;
