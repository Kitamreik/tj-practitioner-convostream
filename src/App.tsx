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
import Bootstrap from "./pages/Bootstrap";
import SmokeTest from "./pages/SmokeTest";
import CallAnalytics from "./pages/CallAnalytics";
import NotFound from "./pages/NotFound";
import Legal from "./pages/Legal";
import WidgetInstall from "./pages/WidgetInstall";
import CookieConsent from "./components/CookieConsent";
import FirestoreErrorBoundary from "./components/FirestoreErrorBoundary";

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
  if (roles && profile && !roles.includes(profile.role)) return <Navigate to="/" replace />;
  if (escalated) {
    const allowed = profile?.role === "webmaster" || profile?.escalatedAccess === true;
    if (!allowed) return <Navigate to="/settings" replace />;
  }
  return <>{children}</>;
};

const AuthRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
};

/**
 * The `/` route renders the Support call-center home for every signed-in
 * role. The Home page is role-aware (greeting, KPIs, quick actions) so an
 * agent, admin, or webmaster all get the same call-center landing experience
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
                {/* First-time setup. Cloud Function gates by webmaster existence. */}
                <Route path="/bootstrap" element={<Bootstrap />} />
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
