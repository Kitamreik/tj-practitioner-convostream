import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import BottomNav from "@/components/BottomNav";

const titleMap: Record<string, string> = {
  "/": "Conversations",
  "/people": "People",
  "/notifications": "Notifications",
  "/integrations": "Integrations",
  "/audit": "Audit Logs",
  "/analytics": "Analytics",
  "/gmail": "Gmail API",
  "/settings": "Settings",
};

const AppLayout: React.FC = () => {
  const location = useLocation();
  const title = titleMap[location.pathname] || "ConvoHub";

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar: hidden on mobile */}
      <div className="hidden md:flex">
        <AppSidebar />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <MessageCircle className="h-4 w-4 text-primary-foreground" />
          </div>
          <h1 className="text-base font-semibold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
            {title}
          </h1>
        </header>

        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </div>
  );
};

export default AppLayout;
