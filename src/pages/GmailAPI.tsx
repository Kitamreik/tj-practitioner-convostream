import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Mail, LogIn, LogOut, RefreshCw, Tag, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest";
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly";

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

interface GmailLabel {
  id: string;
  name: string;
  type: string;
}

const GmailAPI: React.FC = () => {
  const [clientId, setClientId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [gapiInited, setGapiInited] = useState(false);
  const [gisInited, setGisInited] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenClientRef = useRef<any>(null);
  const scriptsLoadedRef = useRef(false);

  // Load Google API scripts
  useEffect(() => {
    if (scriptsLoadedRef.current) return;
    scriptsLoadedRef.current = true;

    const loadScript = (src: string, onload: () => void) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.defer = true;
      script.onload = onload;
      document.head.appendChild(script);
    };

    loadScript("https://apis.google.com/js/api.js", () => {
      window.gapi.load("client", () => setGapiInited(true));
    });

    loadScript("https://accounts.google.com/gsi/client", () => {
      setGisInited(true);
    });
  }, []);

  const initializeClient = useCallback(async () => {
    if (!clientId.trim() || !apiKey.trim()) {
      toast({ title: "Missing credentials", description: "Enter both Client ID and API Key.", variant: "destructive" });
      return;
    }
    try {
      await window.gapi.client.init({
        apiKey: apiKey,
        discoveryDocs: [DISCOVERY_DOC],
      });
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: "",
      });
      toast({ title: "Initialized", description: "Gmail API client ready. Click Authorize to sign in." });
    } catch (err: any) {
      setError(err.message || "Failed to initialize");
    }
  }, [clientId, apiKey]);

  const handleAuth = useCallback(() => {
    if (!tokenClientRef.current) {
      toast({ title: "Not initialized", description: "Enter credentials and initialize first.", variant: "destructive" });
      return;
    }
    tokenClientRef.current.callback = async (resp: any) => {
      if (resp.error) {
        setError(resp.error);
        return;
      }
      setAuthorized(true);
      setError(null);
      toast({ title: "Authorized", description: "Gmail access granted." });
      await fetchLabels();
    };

    if (window.gapi.client.getToken() === null) {
      tokenClientRef.current.requestAccessToken({ prompt: "consent" });
    } else {
      tokenClientRef.current.requestAccessToken({ prompt: "" });
    }
  }, []);

  const handleSignout = useCallback(() => {
    const token = window.gapi.client.getToken();
    if (token) {
      window.google.accounts.oauth2.revoke(token.access_token);
      window.gapi.client.setToken("");
    }
    setAuthorized(false);
    setLabels([]);
    toast({ title: "Signed out" });
  }, []);

  const fetchLabels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await window.gapi.client.gmail.users.labels.list({ userId: "me" });
      const result = response.result.labels || [];
      setLabels(result.map((l: any) => ({ id: l.id, name: l.name, type: l.type || "user" })));
    } catch (err: any) {
      setError(err.message || "Failed to fetch labels");
    } finally {
      setLoading(false);
    }
  }, []);

  const ready = gapiInited && gisInited;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Mail className="h-7 w-7 text-primary" />
          Gmail API
        </h1>
        <p className="text-muted-foreground mt-1">Connect to Gmail and view labels from your inbox</p>
      </div>

      {/* Credentials */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-card p-6 mb-6">
        <h3 className="text-lg font-semibold text-card-foreground mb-4">Google API Credentials</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>OAuth Client ID</Label>
            <Input placeholder="xxxx.apps.googleusercontent.com" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>API Key</Label>
            <Input type="password" placeholder="AIzaSy..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <Button onClick={initializeClient} disabled={!ready || !clientId.trim() || !apiKey.trim()}>
            Initialize Client
          </Button>
          {!ready && <p className="text-xs text-muted-foreground self-center">Loading Google libraries…</p>}
        </div>
      </motion.div>

      {/* Auth + Actions */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="rounded-xl border border-border bg-card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-card-foreground">Authorization</h3>
          <Badge variant={authorized ? "default" : "outline"} className={authorized ? "bg-green-500/10 text-green-600 border-green-500/20" : ""}>
            {authorized ? "Connected" : "Not Connected"}
          </Badge>
        </div>
        <div className="flex gap-2">
          {!authorized ? (
            <Button onClick={handleAuth} className="gap-2" disabled={!tokenClientRef.current}>
              <LogIn className="h-4 w-4" /> Authorize
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={fetchLabels} className="gap-2" disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh Labels
              </Button>
              <Button variant="ghost" onClick={handleSignout} className="gap-2 text-destructive">
                <LogOut className="h-4 w-4" /> Sign Out
              </Button>
            </>
          )}
        </div>
      </motion.div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 mb-6 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Labels */}
      {authorized && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }} className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold text-card-foreground mb-4 flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" /> Gmail Labels
          </h3>
          {labels.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">No labels found.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {labels.map((label) => (
                <Badge key={label.id} variant={label.type === "system" ? "default" : "outline"} className="text-xs">
                  {label.name}
                </Badge>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Setup guide */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }} className="rounded-xl bg-muted/50 border border-border p-6 mt-6">
        <h3 className="font-semibold text-foreground mb-3">Setup Guide</h3>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
          <li>Go to <strong className="text-foreground">Google Cloud Console</strong> → APIs & Services → Credentials</li>
          <li>Create an <strong className="text-foreground">OAuth 2.0 Client ID</strong> (Web application)</li>
          <li>Add <code className="bg-muted px-1 rounded text-foreground">{window.location.origin}</code> to Authorized JavaScript Origins</li>
          <li>Create an <strong className="text-foreground">API Key</strong> and restrict to Gmail API</li>
          <li>Enable the <strong className="text-foreground">Gmail API</strong> in your project</li>
          <li>Paste credentials above and click Initialize Client</li>
        </ol>
      </motion.div>
    </div>
  );
};

export default GmailAPI;
