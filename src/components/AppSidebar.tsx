import React from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path: string;
  roles?: ("admin" | "webmaster")[];
}

const navItems: NavItem[] = [
  { label: "Conversations", icon: <MessageCircle className="h-5 w-5" />, path: "/" },
  { label: "People", icon: <Users className="h-5 w-5" />, path: "/people" },
  { label: "Notifications", icon: <Bell className="h-5 w-5" />, path: "/notifications" },
  { label: "Integrations", icon: <Plug className="h-5 w-5" />, path: "/integrations" },
  { label: "Audit Logs", icon: <Shield className="h-5 w-5" />, path: "/audit", roles: ["webmaster"] },
  { label: "Analytics", icon: <BarChart3 className="h-5 w-5" />, path: "/analytics" },
  { label: "Settings", icon: <Settings className="h-5 w-5" />, path: "/settings" },
];

const AppSidebar: React.FC = () => {
  const { profile, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const filteredNav = navItems.filter(
    (item) => !item.roles || (profile && item.roles.includes(profile.role))
  );

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
        {filteredNav.map((item) => (
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
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3 space-y-2">
        <Button variant="ghost" size="sm" className="w-full justify-start gap-3" onClick={toggleTheme}>
          {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          {theme === "light" ? "Dark Mode" : "Light Mode"}
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
