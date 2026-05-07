import React, { useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import BottomNav from "@/components/BottomNav";
import ScrollToTop from "@/components/ScrollToTop";
import SiteFooter from "@/components/SiteFooter";
import PWAInstallBanner from "@/components/PWAInstallBanner";
import { useAuth } from "@/contexts/AuthContext";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { toast } from "@/hooks/use-toast";
import { useBackgroundGmailPoller } from "@/hooks/useBackgroundGmailPoller";

const titleMap: Record<string, string> = {
  "/": "Conversations",
  "/people": "People",
  "/notifications": "Notifications",
  "/integrations": "Integrations",
  "/audit": "Audit Logs",
  "/analytics": "Analytics",
  "/gmail": "Gmail API",
  "/settings": "Settings",
  "/archive": "Archive",
};

const AUTOPUSH_KEY = "convohub.autoPushed";

const AppLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const title = titleMap[location.pathname] || "ConvoHub";

  // Background Gmail → ConvoHub ingestion. No-op for non-webmasters and for
  // webmasters who haven't yet completed the one-time consent on /gmail-api.
  useBackgroundGmailPoller();

  // Auto-push the agent to one of their open assigned conversations on sign-in.
  // Runs at most once per browser session per uid, and ONLY when the user
  // first lands on the index route — never override an explicit deep link
  // (e.g. /conversations/:id, /settings, etc.).
  const pushedRef = useRef(false);
  useEffect(() => {
    if (pushedRef.current) return;
    if (!user || !profile) return;
    if (location.pathname !== "/") return;
    // Webmasters get the full overview page; don't yank them into a thread.
    if (profile.role === "webmaster") return;

    const sessionKey = `${AUTOPUSH_KEY}:${user.uid}`;
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(sessionKey)) {
      pushedRef.current = true;
      return;
    }

    const agentName = profile.displayName || profile.email;
    if (!agentName) return;

    pushedRef.current = true;
    (async () => {
      try {
        // Prefer the agent's most-recent open conversation. Falling back to a
        // pure equality query keeps the index requirements minimal.
        const q = query(
          collection(db, "conversations"),
          where("assignedAgent", "==", agentName),
          where("status", "in", ["active", "waiting"]),
          limit(5)
        );
        const snap = await getDocs(q);
        if (snap.empty) return;
        // Pick the first non-archived doc; sort client-side by timestamp desc.
        const docs = snap.docs
          .map((d) => ({ id: d.id, data: d.data() as any }))
          .filter((d) => !d.data.archived)
          .sort((a, b) => {
            const ta = a.data.timestamp?.toMillis?.() ?? 0;
            const tb = b.data.timestamp?.toMillis?.() ?? 0;
            return tb - ta;
          });
        if (docs.length === 0) return;
        const target = docs[0];
        try { sessionStorage.setItem(sessionKey, "1"); } catch { /* noop */ }
        navigate(`/conversations/${target.id}`, { replace: true });
        toast({
          title: "Welcome back",
          description: `Jumped to your assigned conversation with ${target.data.customerName ?? "a customer"}.`,
        });
      } catch (err) {
        // Silent — never block the UI on this convenience feature.
        console.warn("Auto-push to assigned conversation failed:", err);
      }
    })();
  }, [user, profile, location.pathname, navigate]);

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

        <main className="flex-1 overflow-y-auto pb-16 md:pb-0 relative">
          <Outlet />
          <SiteFooter variant="app" />
          <ScrollToTop />
        </main>
      </div>

      <BottomNav />
      <PWAInstallBanner />
    </div>
  );
};

export default AppLayout;
