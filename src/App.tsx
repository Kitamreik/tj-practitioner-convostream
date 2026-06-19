import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import AppLayout from "./components/AppLayout";
import Conversations from "./pages/Conversations";
import Home from "./pages/Home";
import Agents from "./pages/Agents";
import Notifications from "./pages/Notifications";
import Integrations from "./pages/Integrations";
import AuditLogs from "./pages/AuditLogs";
import Analytics from "./pages/Analytics";
import GmailAPI from "./pages/GmailAPI";
import SettingsPage from "./pages/Settings";
import Archive from "./pages/Archive";
import AgentLogs from "./pages/AgentLogs";
import StaffUpdates from "./pages/StaffUpdates";
import FileRecordings from "./pages/FileRecordings";
import IconKey from "./pages/IconKey";
import Chat from "./pages/Chat";
import PendingApproval from "./pages/PendingApproval";
import SmokeTest from "./pages/SmokeTest";
import SecurityFindings from "./pages/SecurityFindings";
import AgentSessions from "./pages/AgentSessions";
import CallAnalytics from "./pages/CallAnalytics";
import NotFound from "./pages/NotFound";
import Legal from "./pages/Legal";
import WidgetInstall from "./pages/WidgetInstall";
import CookieConsent from "./components/CookieConsent";
import FirestoreErrorBoundary from "./components/FirestoreErrorBoundary";
import PortalLogin from "./pages/portal/PortalLogin";
import PortalSignup from "./pages/portal/PortalSignup";
// PortalConversations is intentionally not imported — the customer landing
// page is now PortalChat (Team Chat). The file is kept on disk for history.
import PortalThread from "./pages/portal/PortalThread";
import PortalChat from "./pages/portal/PortalChat";

const queryClient = new QueryClient();

const ProtectedRoute: React.FC<{
  children: React.ReactNode;
  roles?: string[];
  /** When true, allow webmasters OR admins with profile.escalatedAccess === true. */
  escalated?: boolean;
}> = ({ children, roles, escalated }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  // Customers must never reach internal/agent routes — bounce them to the
  // customer portal instead.
  if (profile?.role === "customer") return <Navigate to="/portal/chat" replace />;
  // Gate: any signed-in user whose account is pending or rejected goes to the
  // /pending-approval landing page until a webmaster/admin reviews them.
  // Webmasters bypass the gate so they can always reach Settings to review.
  if (
    profile &&
    profile.role !== "webmaster" &&
    profile.approvalStatus &&
    profile.approvalStatus !== "approved"
  ) {
    return <Navigate to="/pending-approval" replace />;
  }
  if (roles && profile && !roles.includes(profile.role)) return <Navigate to="/" replace />;
  if (escalated) {
    const allowed = profile?.role === "webmaster" || profile?.escalatedAccess === true;
    if (!allowed) return <Navigate to="/settings" replace />;
  }
  return <>{children}</>;
};

const AuthRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  if (user) {
    if (profile?.role === "customer") return <Navigate to="/portal/chat" replace />;
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

/**
 * Customer-only gate for /portal/* routes. Sends unauthenticated users to
 * the customer sign-in page and bounces internal roles (agent/admin/
 * webmaster) back to the staff app so the portal is purely customer-facing.
 */
const CustomerRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  if (!user) return <Navigate to="/portal/login" replace />;
  if (profile && profile.role !== "customer") return <Navigate to="/" replace />;
  // Customer accounts wait for webmaster/admin approval before they can
  // reach the Team Chat. Render a small pending screen instead of routing
  // them out so they don't bounce back to the login page.
  if (profile && profile.approvalStatus && profile.approvalStatus !== "approved") {
    return <PortalPending status={profile.approvalStatus} note={profile.rejectionNote} />;
  }
  return <>{children}</>;
};

const PortalPending: React.FC<{ status: "pending" | "rejected"; note?: string }> = ({ status, note }) => {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <h1 className="text-2xl font-semibold">
        {status === "pending" ? "Account awaiting approval" : "Account not approved"}
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {status === "pending"
          ? "Thanks for signing up. A webmaster or admin will review your account and grant access to Team Chat shortly."
          : note || "Please contact support if you believe this was a mistake."}
      </p>
      <button
        onClick={() => signOut()}
        className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
      >
        Sign out
      </button>
    </div>
  );
};

/**
 * The `/` route renders the Support call-center home for every signed-in
 * role. The Home page is role-aware (greeting, KPIs, quick actions) so an
 * agent, admin, or webmaster all get the same call-center call-center experience
 * mirrored from the original Support UI. The legacy support@convohub.dev /
 * `supportAccess` flag is no longer required to see this view.
 */
const SupportHomeOrConversations: React.FC = () => {
  return <Home />;
};

const App = () => (
  <FirestoreErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <CookieConsent />
              <Routes>
                <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />
                <Route path="/forgot-password" element={<AuthRoute><ForgotPassword /></AuthRoute>} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/legal/:slug" element={<Legal />} />
                <Route path="/legal" element={<Legal />} />
                {/* Approval gate landing page — reached when an approved profile
                    is missing or the account was rejected. Requires sign-in. */}
                <Route path="/pending-approval" element={<PendingApproval />} />
                {/* ----------- Customer portal route tree ----------- */}
                <Route path="/portal/login" element={<AuthRoute><PortalLogin /></AuthRoute>} />
                <Route path="/portal/signup" element={<AuthRoute><PortalSignup /></AuthRoute>} />
                <Route path="/portal" element={<Navigate to="/portal/chat" replace />} />
                {/* Legacy redirect — customers used to land on a "Welcome"
                    conversations console; their primary surface is now the
                    Team Chat. PortalConversations is kept exported but no
                    longer routed to keep historical bookmarks working. */}
                <Route path="/portal/conversations" element={<Navigate to="/portal/chat" replace />} />
                <Route
                  path="/portal/chat"
                  element={<CustomerRoute><PortalChat /></CustomerRoute>}
                />
                <Route
                  path="/portal/conversations/:id"
                  element={<CustomerRoute><PortalThread /></CustomerRoute>}
                />

                <Route
                  element={
                    <ProtectedRoute>
                      <AppLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route path="/" element={<SupportHomeOrConversations />} />
                  <Route path="/conversations" element={<Conversations />} />
                  <Route path="/conversations/:id" element={<Conversations />} />
                  <Route path="/chat" element={<Chat />} />
                  <Route path="/agents" element={<Agents />} />
                  {/* Legacy redirect: /people → /agents */}
                  <Route path="/people" element={<Navigate to="/agents" replace />} />
                  <Route path="/notifications" element={<Notifications />} />
                  <Route path="/integrations" element={<ProtectedRoute escalated><Integrations /></ProtectedRoute>} />
                  <Route path="/audit" element={<ProtectedRoute roles={["webmaster"]}><AuditLogs /></ProtectedRoute>} />
                  <Route path="/analytics" element={<ProtectedRoute escalated><Analytics /></ProtectedRoute>} />
                  <Route path="/gmail" element={<ProtectedRoute escalated><GmailAPI /></ProtectedRoute>} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/widget-install" element={<ProtectedRoute escalated><WidgetInstall /></ProtectedRoute>} />
                  <Route path="/archive" element={<Archive />} />
                  <Route path="/agent-logs" element={<AgentLogs />} />
                  <Route path="/staff-updates" element={<StaffUpdates />} />
                  <Route path="/file-recordings" element={<FileRecordings />} />
                  <Route path="/icon-key" element={<IconKey />} />
                  <Route path="/smoke-test" element={<ProtectedRoute roles={["webmaster"]}><SmokeTest /></ProtectedRoute>} />
                  <Route path="/security" element={<ProtectedRoute roles={["webmaster"]}><SecurityFindings /></ProtectedRoute>} />
                  <Route path="/agent-sessions" element={<ProtectedRoute roles={["webmaster"]}><AgentSessions /></ProtectedRoute>} />
                  <Route path="/call-analytics" element={<CallAnalytics />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </FirestoreErrorBoundary>
);

export default App;
