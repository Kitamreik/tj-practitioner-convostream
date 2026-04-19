import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useNavigate, useLocation } from "react-router-dom";
import {
  MessageCircle,
  Users,
  Settings,
  LogOut,
  Moon,
  Sun,
  BarChart3,
  Bell,
  Plug,
  Shield,
  Mail,
  Archive as ArchiveIcon,
  ScrollText,
  Megaphone,
  FileVideo,
  KeyRound,
  Eye,
} from "lucide-react";
import WebmasterContactButtons from "@/components/WebmasterContactButtons";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getActiveCount, subscribeRecordings } from "@/lib/fileRecordings";
import { getBoolPref, subscribeBoolPref } from "@/lib/userPrefs";
import { useIntegrationsHealth } from "@/hooks/useIntegrationsHealth";

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path: string;
  roles?: ("agent" | "admin" | "webmaster")[];
  /** When true, this item is hidden from non-escalated admins. */
  webmasterOrEscalated?: boolean;
  badgeKey?: string;
}

// Trimmed nav: Icon Key, Analytics, and Agents removed per product direction
// (the routes themselves still exist so deep links don't 404 — only the
// sidebar entry points are gone). Webmaster-only utility links remain.
const navItems: NavItem[] = [
  { label: "Staff Updates", icon: <Megaphone className="h-5 w-5" />, path: "/staff-updates", badgeKey: "staff" },
  { label: "Notifications", icon: <Bell className="h-5 w-5" />, path: "/notifications", badgeKey: "notifications" },
  { label: "Conversations", icon: <MessageCircle className="h-5 w-5" />, path: "/", badgeKey: "conversations" },
  { label: "Agent Logs", icon: <ScrollText className="h-5 w-5" />, path: "/agent-logs" },
  { label: "File Recordings", icon: <FileVideo className="h-5 w-5" />, path: "/file-recordings", badgeKey: "recordings" },
  { label: "Integrations", icon: <Plug className="h-5 w-5" />, path: "/integrations", webmasterOrEscalated: true },
  { label: "Audit Logs", icon: <Shield className="h-5 w-5" />, path: "/audit", roles: ["webmaster"] },
  { label: "Gmail API", icon: <Mail className="h-5 w-5" />, path: "/gmail", webmasterOrEscalated: true },
  { label: "Archive", icon: <ArchiveIcon className="h-5 w-5" />, path: "/archive" },
  { label: "Settings", icon: <Settings className="h-5 w-5" />, path: "/settings" },
];

const AppSidebar: React.FC = () => {
  const { profile, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({ active: 0, waiting: 0 });
  const [notificationCount, setNotificationCount] = useState(0);
  const [staffActive, setStaffActive] = useState(0);
  const [recordingsActive, setRecordingsActive] = useState<number>(() => getActiveCount());

  // Listen for unread conversations
  useEffect(() => {
    const q = query(collection(db, "conversations"), where("unread", "==", true));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        let active = 0;
        let waiting = 0;
        snapshot.docs.forEach((d) => {
          const data = d.data();
          if (data.status === "active") active++;
          else if (data.status === "waiting") waiting++;
        });
        setUnreadCounts({ active, waiting });
      },
      () => {
        setUnreadCounts({ active: 1, waiting: 1 });
      }
    );
    return unsub;
  }, []);

  // Listen for unread notifications in the user's per-user subcollection.
  // Notes created on the Notifications page live under users/{uid}/notifications.
  const userUid = profile?.uid;
  useEffect(() => {
    if (!userUid) {
      setNotificationCount(0);
      return;
    }
    const q = query(
      collection(db, "users", userUid, "notifications"),
      where("read", "==", false)
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => setNotificationCount(snapshot.size),
      () => setNotificationCount(0)
    );
    return unsub;
  }, [userUid]);

  // Active (non-resolved) staff updates — drives the red sidebar badge.
  useEffect(() => {
    const q = query(collection(db, "staff_updates"), where("status", "in", ["ongoing", "maintenance"]));
    const unsub = onSnapshot(q, (snap) => setStaffActive(snap.size), () => setStaffActive(0));
    return unsub;
  }, []);

  // Active file recordings — local-only, but updates live via custom event.
  useEffect(() => {
    setRecordingsActive(getActiveCount());
    return subscribeRecordings(() => setRecordingsActive(getActiveCount()));
  }, []);

  // Mirror the bottom nav: show a small "muted" dot on the Notifications row
  // when the user has hidden team broadcasts on /notifications.
  const [broadcastsMuted, setBroadcastsMuted] = useState(false);
  useEffect(() => {
    setBroadcastsMuted(getBoolPref(userUid, "notifications.muteBroadcasts", false));
    return subscribeBoolPref(userUid, "notifications.muteBroadcasts", setBroadcastsMuted);
  }, [userUid]);

  const totalUnread = unreadCounts.active + unreadCounts.waiting;

  // Webmaster-only: subscribe to the latest scheduled/manual health check
  // so we can paint a red dot on the Integrations row when any provider is
  // failing. Non-webmasters can't read the doc (rules) — hook returns null.
  const isWebmaster = profile?.role === "webmaster";
  const integrationsHealth = useIntegrationsHealth(isWebmaster);
  const integrationsFailing = !!integrationsHealth?.anyFailing;
  const lastCheckedLabel = integrationsHealth?.checkedAtMs
    ? new Date(integrationsHealth.checkedAtMs).toLocaleString()
    : "Not yet run";

  const filteredNav = navItems.filter((item) => {
    if (item.roles && !(profile && item.roles.includes(profile.role))) return false;
    if (item.webmasterOrEscalated) {
      const allowed = profile?.role === "webmaster" || profile?.escalatedAccess === true;
      if (!allowed) return false;
    }
    return true;
  });

  const getBadge = (item: NavItem) => {
    if (item.badgeKey === "conversations" && totalUnread > 0) return totalUnread;
    if (item.badgeKey === "notifications" && notificationCount > 0) return notificationCount;
    if (item.badgeKey === "staff" && staffActive > 0) return staffActive;
    if (item.badgeKey === "recordings" && recordingsActive > 0) return recordingsActive;
    return 0;
  };

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-3 border-b border-sidebar-border p-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar-primary">
          <MessageCircle className="h-5 w-5 text-sidebar-primary-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-sidebar-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
            ConvoHub
          </h1>
          <span className="text-xs capitalize text-muted-foreground">{profile?.role}</span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {filteredNav.map((item) => {
          const badge = getBadge(item);
          const showMutedDot = item.badgeKey === "notifications" && broadcastsMuted;
          const showHealthDot = item.path === "/integrations" && integrationsFailing;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                location.pathname === item.path
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <span className="relative inline-flex">
                {item.icon}
                {showMutedDot && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => {
                          // Stop the parent row from also firing — navigate
                          // with a hash so the toggle scrolls into view.
                          e.stopPropagation();
                          navigate("/notifications#mute-broadcasts-toggle");
                        }}
                        className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-warning ring-2 ring-sidebar"
                        aria-label="Team broadcasts muted — tap to manage"
                      />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="text-xs">
                      Team broadcasts muted — tap to manage
                    </TooltipContent>
                  </Tooltip>
                )}
                {showHealthDot && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-destructive ring-2 ring-sidebar animate-pulse"
                        aria-label={`Integration issue: ${integrationsHealth?.failingProviders.join(", ")}`}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="text-xs max-w-[220px]">
                      <div className="font-semibold mb-0.5">Integration issue</div>
                      <div className="text-muted-foreground">
                        {integrationsHealth?.failingProviders.length
                          ? `Failing: ${integrationsHealth.failingProviders.join(", ")}`
                          : "Last health check found a problem."}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground/80">
                        Last checked: {lastCheckedLabel}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                )}
              </span>
              <span className="flex-1 text-left">{item.label}</span>
              {badge > 0 && (
                <span className={cn(
                  "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
                  item.badgeKey === "staff" || item.badgeKey === "recordings"
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-primary text-primary-foreground"
                )}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Unread breakdown */}
      {totalUnread > 0 && (
        <div className="mx-3 mb-2 rounded-lg bg-primary/5 border border-primary/20 p-3">
          <p className="text-xs font-medium text-foreground mb-1">Unread Conversations</p>
          <div className="flex gap-3 text-xs text-muted-foreground">
            {unreadCounts.active > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" />{unreadCounts.active} active</span>}
            {unreadCounts.waiting > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent" />{unreadCounts.waiting} waiting</span>}
          </div>
        </div>
      )}

      <div className="border-t border-sidebar-border p-3 space-y-2">
        {/* Direct line to the on-call webmaster — hidden for the webmaster
            themselves (the component handles that gating). */}
        <WebmasterContactButtons className="w-full" />

        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-3"
          onClick={toggleTheme}
          aria-label={`Switch theme — current: ${theme}. Cycles light → dark → coder.`}
          title="Cycle theme: light → dark → coder"
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

        <div className="flex items-center gap-3 rounded-lg bg-sidebar-accent/50 px-3 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {profile?.displayName?.charAt(0)?.toUpperCase() || "U"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-medium text-sidebar-foreground">{profile?.displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{profile?.email}</p>
          </div>
          <button onClick={signOut} className="text-muted-foreground hover:text-destructive">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};

export default AppSidebar;
