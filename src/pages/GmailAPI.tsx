import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, LogIn, LogOut, RefreshCw, Tag, AlertCircle, Inbox, ArrowLeft, Paperclip, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

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

interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body: string;
  hasAttachments: boolean;
  labelIds: string[];
}

function decodeBase64Url(str: string): string {
  try {
    const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    return decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
  } catch {
    return str;
  }
}

function getHeader(headers: any[], name: string): string {
  const h = headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

function extractBody(payload: any): string {
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  if (payload.parts) {
    // Prefer text/html, fallback to text/plain
    const htmlPart = payload.parts.find((p: any) => p.mimeType === "text/html");
    if (htmlPart?.body?.data) return decodeBase64Url(htmlPart.body.data);
    const textPart = payload.parts.find((p: any) => p.mimeType === "text/plain");
    if (textPart?.body?.data) return decodeBase64Url(textPart.body.data);
    // Nested multipart
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }
  return "";
}

function hasAttachments(payload: any): boolean {
  if (payload.parts) {
    return payload.parts.some((p: any) => p.filename && p.filename.length > 0);
  }
  return false;
}

const GmailAPI: React.FC = () => {
  const [clientId, setClientId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [gapiInited, setGapiInited] = useState(false);
  const [gisInited, setGisInited] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<GmailMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"labels" | "messages">("messages");
  const tokenClientRef = useRef<any>(null);
  const scriptsLoadedRef = useRef(false);

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
      await window.gapi.client.init({ apiKey, discoveryDocs: [DISCOVERY_DOC] });
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

  const fetchMessages = useCallback(async () => {
    setLoadingMessages(true);
    setError(null);
    try {
      const listResp = await window.gapi.client.gmail.users.messages.list({
        userId: "me",
        maxResults: 20,
        labelIds: ["INBOX"],
      });
      const messageIds = listResp.result.messages || [];
      if (messageIds.length === 0) {
        setMessages([]);
        return;
      }

      const batch = window.gapi.client.newBatch();
      messageIds.forEach((m: any) => {
        batch.add(
          window.gapi.client.gmail.users.messages.get({ userId: "me", id: m.id, format: "full" }),
          { id: m.id }
        );
      });

      const batchResp = await batch;
      const parsed: GmailMessage[] = [];
      for (const key of Object.keys(batchResp.result)) {
        const msg = batchResp.result[key].result;
        if (!msg?.payload) continue;
        const headers = msg.payload.headers || [];
        parsed.push({
          id: msg.id,
          threadId: msg.threadId,
          subject: getHeader(headers, "Subject") || "(no subject)",
          from: getHeader(headers, "From"),
          date: getHeader(headers, "Date"),
          snippet: msg.snippet || "",
          body: extractBody(msg.payload),
          hasAttachments: hasAttachments(msg.payload),
          labelIds: msg.labelIds || [],
        });
      }
      parsed.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setMessages(parsed);
    } catch (err: any) {
      setError(err.message || "Failed to fetch messages");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const handleAuth = useCallback(() => {
    if (!tokenClientRef.current) {
      toast({ title: "Not initialized", description: "Enter credentials and initialize first.", variant: "destructive" });
      return;
    }
    tokenClientRef.current.callback = async (resp: any) => {
      if (resp.error) { setError(resp.error); return; }
      setAuthorized(true);
      setError(null);
      toast({ title: "Authorized", description: "Gmail access granted." });
      await Promise.all([fetchLabels(), fetchMessages()]);
    };
    if (window.gapi.client.getToken() === null) {
      tokenClientRef.current.requestAccessToken({ prompt: "consent" });
    } else {
      tokenClientRef.current.requestAccessToken({ prompt: "" });
    }
  }, [fetchLabels, fetchMessages]);

  const handleSignout = useCallback(() => {
    const token = window.gapi.client.getToken();
    if (token) {
      window.google.accounts.oauth2.revoke(token.access_token);
      window.gapi.client.setToken("");
    }
    setAuthorized(false);
    setLabels([]);
    setMessages([]);
    setSelectedMessage(null);
    toast({ title: "Signed out" });
  }, []);

  const ready = gapiInited && gisInited;

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    } catch { return dateStr; }
  };

  const formatFromName = (from: string) => {
    const match = from.match(/^"?([^"<]+)"?\s*</);
    return match ? match[1].trim() : from.split("@")[0];
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Mail className="h-7 w-7 text-primary" />
          Gmail API
        </h1>
        <p className="text-muted-foreground mt-1">Connect to Gmail to view labels and email messages</p>
      </div>

      {/* Credentials */}
      {!authorized && (
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
            <Button onClick={initializeClient} disabled={!ready || !clientId.trim() || !apiKey.trim()}>Initialize Client</Button>
            {!ready && <p className="text-xs text-muted-foreground self-center">Loading Google libraries…</p>}
          </div>
        </motion.div>
      )}

      {/* Auth */}
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
              <Button variant="outline" onClick={fetchMessages} className="gap-2" disabled={loadingMessages}>
                <RefreshCw className={`h-4 w-4 ${loadingMessages ? "animate-spin" : ""}`} /> Refresh
              </Button>
              <Button variant="ghost" onClick={handleSignout} className="gap-2 text-destructive">
                <LogOut className="h-4 w-4" /> Sign Out
              </Button>
            </>
          )}
        </div>
      </motion.div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 mb-6 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Tabs */}
      {authorized && (
        <>
          <div className="flex gap-1 mb-6 border-b border-border">
            <button
              onClick={() => { setActiveTab("messages"); setSelectedMessage(null); }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "messages" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <Inbox className="h-4 w-4 inline mr-2" />Inbox ({messages.length})
            </button>
            <button
              onClick={() => { setActiveTab("labels"); setSelectedMessage(null); }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "labels" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <Tag className="h-4 w-4 inline mr-2" />Labels ({labels.length})
            </button>
          </div>

          <AnimatePresence mode="wait">
            {activeTab === "labels" && (
              <motion.div key="labels" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-xl border border-border bg-card p-6">
                {labels.length === 0 && !loading ? (
                  <p className="text-sm text-muted-foreground">No labels found.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {labels.map((label) => (
                      <Badge key={label.id} variant={label.type === "system" ? "default" : "outline"} className="text-xs">{label.name}</Badge>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === "messages" && !selectedMessage && (
              <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-xl border border-border bg-card overflow-hidden">
                {loadingMessages ? (
                  <div className="p-4 space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex gap-3 items-start">
                        <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-1/3" />
                          <Skeleton className="h-3 w-full" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground">
                    <Inbox className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p>No messages found in your inbox.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {messages.map((msg) => (
                      <button
                        key={msg.id}
                        onClick={() => setSelectedMessage(msg)}
                        className="w-full text-left px-5 py-3.5 hover:bg-muted/40 transition-colors flex gap-3 items-start"
                      >
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary mt-0.5">
                          {formatFromName(msg.from).charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-foreground truncate">{formatFromName(msg.from)}</span>
                            <span className="text-xs text-muted-foreground flex-shrink-0 flex items-center gap-1">
                              {msg.hasAttachments && <Paperclip className="h-3 w-3" />}
                              <Clock className="h-3 w-3" />
                              {formatDate(msg.date)}
                            </span>
                          </div>
                          <p className="text-sm text-foreground truncate">{msg.subject}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{msg.snippet}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === "messages" && selectedMessage && (
              <motion.div key="detail" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="rounded-xl border border-border bg-card">
                <div className="border-b border-border px-6 py-4">
                  <Button variant="ghost" size="sm" className="gap-1.5 mb-3 -ml-2" onClick={() => setSelectedMessage(null)}>
                    <ArrowLeft className="h-4 w-4" /> Back to Inbox
                  </Button>
                  <h2 className="text-lg font-semibold text-foreground">{selectedMessage.subject}</h2>
                  <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{selectedMessage.from}</span>
                    <span>•</span>
                    <span>{new Date(selectedMessage.date).toLocaleString()}</span>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    {selectedMessage.labelIds.map((l) => (
                      <Badge key={l} variant="outline" className="text-[10px]">{l}</Badge>
                    ))}
                  </div>
                </div>
                <div className="p-6">
                  {selectedMessage.body.includes("<") ? (
                    <div
                      className="prose prose-sm max-w-none dark:prose-invert"
                      dangerouslySetInnerHTML={{ __html: selectedMessage.body }}
                    />
                  ) : (
                    <pre className="text-sm text-foreground whitespace-pre-wrap font-sans">{selectedMessage.body || selectedMessage.snippet}</pre>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Setup guide */}
      {!authorized && (
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
      )}
    </div>
  );
};

export default GmailAPI;
