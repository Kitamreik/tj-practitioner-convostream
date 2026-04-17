import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { MessageCircle, Users, Bell, BarChart3, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { Plug, Shield, Mail, Settings as SettingsIcon, LogOut, Moon, Sun, Archive as ArchiveIcon } from "lucide-react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path: string;
  badgeKey?: string;
  webmasterOrEscalated?: boolean;
  roles?: ("admin" | "webmaster")[];
}

const chatsItem: NavItem = { label: "Chats", icon: <MessageCircle className="h-5 w-5" />, path: "/", badgeKey: "conversations" };
const peopleItem: NavItem = { label: "People", icon: <Users className="h-5 w-5" />, path: "/people" };
const alertsItem: NavItem = { label: "Alerts", icon: <Bell className="h-5 w-5" />, path: "/notifications", badgeKey: "notifications" };
const statsItem: NavItem = { label: "Stats", icon: <BarChart3 className="h-5 w-5" />, path: "/analytics", webmasterOrEscalated: true };

const moreItems: NavItem[] = [
  { label: "Integrations", icon: <Plug className="h-5 w-5" />, path: "/integrations", webmasterOrEscalated: true },
  { label: "Audit Logs", icon: <Shield className="h-5 w-5" />, path: "/audit", roles: ["webmaster"] },
  { label: "Gmail API", icon: <Mail className="h-5 w-5" />, path: "/gmail", webmasterOrEscalated: true },
  { label: "Archive", icon: <ArchiveIcon className="h-5 w-5" />, path: "/archive" },
  { label: "Settings", icon: <SettingsIcon className="h-5 w-5" />, path: "/settings" },
];

const BottomNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [unread, setUnread] = useState(0);
  const [notifs, setNotifs] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "conversations"), where("unread", "==", true));
    const unsub = onSnapshot(q, (snap) => setUnread(snap.size), () => setUnread(2));
    return unsub;
  }, []);

  useEffect(() => {
    const q = query(collection(db, "notifications"), where("read", "==", false));
    const unsub = onSnapshot(q, (snap) => setNotifs(snap.size), () => setNotifs(2));
    return unsub;
  }, []);

  const getBadge = (item: NavItem) => {
    if (item.badgeKey === "conversations") return unread;
    if (item.badgeKey === "notifications") return notifs;
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
            </div>
            <span>{item.label}</span>
          </button>
        );
      })}

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetTrigger asChild>
          <button
            className="flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium text-muted-foreground"
            aria-label="More"
          >
            <Menu className="h-5 w-5" />
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
              .map((item) => (
                <button
                  key={item.path}
                  onClick={() => go(item.path)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border border-border p-3 text-sm font-medium transition-colors",
                    location.pathname === item.path ? "bg-accent" : "hover:bg-muted/50"
                  )}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
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
            <Button variant="ghost" size="sm" className="w-full justify-start gap-3" onClick={toggleTheme}>
              {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              {theme === "light" ? "Dark Mode" : "Light Mode"}
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
