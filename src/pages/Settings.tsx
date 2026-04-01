import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Moon, Sun, User, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const SettingsPage: React.FC = () => {
  const { profile } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and preferences</p>
      </div>

      <div className="space-y-8">
        {/* Profile */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-4">
            <User className="h-5 w-5 text-primary" />
            Profile
          </h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input value={profile?.displayName || ""} readOnly className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={profile?.email || ""} readOnly className="bg-muted" />
            </div>
            <div className="flex items-center gap-2">
              <Label>Role</Label>
              <Badge variant="secondary" className="capitalize">{profile?.role}</Badge>
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-4">
            {theme === "light" ? <Sun className="h-5 w-5 text-primary" /> : <Moon className="h-5 w-5 text-primary" />}
            Appearance
          </h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Theme</p>
              <p className="text-xs text-muted-foreground">Switch between light and dark mode</p>
            </div>
            <Button variant="outline" onClick={toggleTheme} className="gap-2">
              {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              {theme === "light" ? "Dark" : "Light"}
            </Button>
          </div>
        </div>

        {/* Security */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-card-foreground mb-4">
            <Shield className="h-5 w-5 text-primary" />
            Security
          </h3>
          <p className="text-sm text-muted-foreground">
            Authentication is managed via Firebase. Use the Firebase Console to reset your password or enable MFA.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
