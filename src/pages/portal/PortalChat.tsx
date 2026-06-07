import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  ChatMessage,
  ChatThread,
  listOtherUsers,
  markThreadRead,
  openOrCreateDmThread,
  sendChatMessage,
  subscribeMyThreads,
  subscribeThreadMessages,
} from "@/lib/chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, LogOut, MessageCircle, Send, UserPlus } from "lucide-react";
import { toast } from "@/hooks/use-toast";

/**
 * PortalChat — the customer-facing portal landing page.
 *
 * Customers do NOT see the agent Welcome console, conversations list,
 * agent logs, or call analytics. Their primary interface is the Team
 * Chat: they can pick any current agent/admin/webmaster from the
 * roster and start (or resume) a 1:1 DM with them.
 *
 * Drafts are mirrored to localStorage as a production failsafe so a
 * lost network / Firestore permission glitch never destroys what the
 * customer just typed.
 */
const PortalChat: React.FC = () => {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agents, setAgents] = useState<{ uid: string; displayName: string; email: string; role: string }[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const draftKey = useMemo(
    () => (user && activeId ? `ConvoHub.portalChat.draft.${user.uid}.${activeId}` : null),
    [user, activeId],
  );

  // Subscribe to my threads (filtered to ones I'm participating in by uid).
  useEffect(() => {
    if (!user) return;
    return subscribeMyThreads(user.uid, setThreads);
  }, [user]);

  // Subscribe to active thread messages + mark read.
  useEffect(() => {
    if (!activeId || !user) {
      setMessages([]);
      return;
    }
    const unsub = subscribeThreadMessages(activeId, setMessages);
    markThreadRead(activeId, user.uid).catch(() => {/* non-fatal */});
    return unsub;
  }, [activeId, user]);

  // Restore draft when switching threads.
  useEffect(() => {
    if (!draftKey) { setDraft(""); return; }
    try {
      setDraft(localStorage.getItem(draftKey) ?? "");
    } catch { setDraft(""); }
  }, [draftKey]);

  // Persist draft on change (failsafe).
  useEffect(() => {
    if (!draftKey) return;
    try {
      if (draft) localStorage.setItem(draftKey, draft);
      else localStorage.removeItem(draftKey);
    } catch { /* private mode */ }
  }, [draft, draftKey]);

  // Auto-scroll on new messages.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const openPicker = async () => {
    if (!user) return;
    setPickerOpen(true);
    try {
      const all = await listOtherUsers(user.uid);
      // Customers can only reach internal agents/admins/webmasters — never
      // each other.
      setAgents(all.filter((u) => u.role && u.role !== "customer"));
    } catch (err) {
      console.warn("[portal-chat] listOtherUsers failed:", err);
      toast({ title: "Couldn't load agents", description: "Please retry in a moment.", variant: "destructive" });
    }
  };

  const startThreadWith = async (agent: { uid: string; email: string; displayName: string }) => {
    if (!user || !profile) return;
    try {
      const id = await openOrCreateDmThread({
        selfUid: user.uid,
        selfEmail: profile.email || user.email || "",
        selfName: profile.displayName || profile.email || "Customer",
        otherUid: agent.uid,
        otherEmail: agent.email,
        otherName: agent.displayName || agent.email,
      });
      setActiveId(id);
      setPickerOpen(false);
    } catch (err: any) {
      toast({ title: "Couldn't start chat", description: err?.message, variant: "destructive" });
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeId || !user || !profile || !draft.trim() || sending) return;
    setSending(true);
    const text = draft.trim();
    try {
      await sendChatMessage({
        threadId: activeId,
        senderUid: user.uid,
        senderEmail: profile.email || user.email || "",
        senderName: profile.displayName || profile.email || "Customer",
        body: text,
      });
      setDraft("");
      if (draftKey) {
        try { localStorage.removeItem(draftKey); } catch { /* noop */ }
      }
    } catch (err: any) {
      console.warn("[portal-chat] send failed; draft kept in localStorage:", err);
      toast({
        title: "Couldn't send — saved locally",
        description: "Your message is saved on this device and will retry when you tap Send again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const onSignOut = async () => {
    await signOut();
    navigate("/portal/login", { replace: true });
  };

  const activeThread = threads.find((t) => t.id === activeId) || null;
  const otherName = (t: ChatThread) => {
    if (!user) return "Agent";
    const idx = t.participantUids.findIndex((u) => u !== user.uid);
    return (idx >= 0 ? t.participantEmails[idx] : "Agent") || "Agent";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/40">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {activeId && (
              <Button variant="ghost" size="icon" onClick={() => setActiveId(null)} aria-label="Back to threads">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
              <MessageCircle className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">
                {activeThread ? otherName(activeThread) : "Team Chat"}
              </h1>
              <p className="truncate text-xs text-muted-foreground">{profile?.email}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onSignOut} className="gap-2">
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        {!activeId ? (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Your conversations</h2>
              <Button size="sm" onClick={openPicker} className="gap-2">
                <UserPlus className="h-4 w-4" /> New chat
              </Button>
            </div>

            {threads.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                No chats yet. Tap “New chat” to message an agent on our team.
              </Card>
            ) : (
              <ul className="space-y-2">
                {threads.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(t.id)}
                      className="block w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-muted/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{otherName(t)}</span>
                        {t.lastMessageAt && (
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {new Date((t.lastMessageAt as any)?.toMillis?.() ?? 0).toLocaleString()}
                          </span>
                        )}
                      </div>
                      {t.lastMessagePreview && (
                        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{t.lastMessagePreview}</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {pickerOpen && (
              <Card className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Pick an agent</p>
                  <Button variant="ghost" size="sm" onClick={() => setPickerOpen(false)}>Close</Button>
                </div>
                {agents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Loading agents…</p>
                ) : (
                  <ul className="space-y-1">
                    {agents.map((a) => (
                      <li key={a.uid}>
                        <button
                          type="button"
                          onClick={() => startThreadWith(a)}
                          className="flex w-full items-center justify-between rounded-md border border-transparent p-2 text-left hover:border-border hover:bg-accent/40"
                        >
                          <div>
                            <p className="text-sm font-medium">{a.displayName}</p>
                            <p className="text-[11px] text-muted-foreground">{a.email}</p>
                          </div>
                          <Badge variant="outline" className="text-[10px]">{a.role}</Badge>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </section>
        ) : (
          <section className="flex h-[70vh] flex-col">
            <ScrollArea className="flex-1 rounded-lg border border-border bg-card p-4">
              <div ref={scrollRef} className="space-y-3">
                {messages.length === 0 && (
                  <p className="text-center text-xs text-muted-foreground">No messages yet — say hi 👋</p>
                )}
                {messages.map((m) => {
                  const mine = m.senderUid === user?.uid;
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                          mine
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        {!mine && (
                          <p className="mb-0.5 text-[10px] font-medium opacity-70">
                            {m.senderName || m.senderEmail}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap break-words">{m.deleted ? "(message removed)" : m.body}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
            <form onSubmit={handleSend} className="mt-3 flex items-end gap-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a message…"
                rows={2}
                className="flex-1 resize-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(e as unknown as React.FormEvent);
                  }
                }}
                autoFocus
              />
              <Button type="submit" disabled={!draft.trim() || sending} className="gap-2">
                <Send className="h-4 w-4" /> Send
              </Button>
            </form>
            {draft && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Draft saved on this device — won’t be lost if you refresh.
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
};

export default PortalChat;
