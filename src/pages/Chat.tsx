import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  archiveChatThread,
  canModerateChat,
  ChatMessage,
  ChatThread,
  clearTyping,
  editChatMessage,
  isOtherTyping,
  isThreadUnread,
  listOtherUsers,
  markThreadRead,
  openOrCreateDmThread,
  pingTyping,
  sendChatMessage,
  softDeleteChatMessage,
  subscribeMyThreads,
  subscribeThreadMessages,
  TYPING_FRESH_MS,
} from "@/lib/chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  MessageSquarePlus,
  MoreVertical,
  Pencil,
  Send,
  Trash2,
  Users as UsersIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSupportUsers, isSupportByUid, isSupportByEmail } from "@/hooks/useSupportUsers";
import { SupportBadge } from "@/components/SupportBadge";

const formatTime = (ts: any) => {
  try {
    if (ts?.toDate) return ts.toDate().toLocaleString([], { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
  } catch {
    /* noop */
  }
  return "";
};

interface OtherUser {
  uid: string;
  email: string;
  displayName: string;
  role: string;
}

const ChatPage: React.FC = () => {
  const { user, profile } = useAuth();
  const isMobile = useIsMobile();
  const isMod = canModerateChat(profile);
  const supportUsers = useSupportUsers();

  /** True when the *other* participant of a thread has Support access. */
  const otherIsSupport = (t: ChatThread): boolean => {
    if (!user) return false;
    const idx = t.participantUids.findIndex((u) => u !== user.uid);
    if (idx < 0) return false;
    const otherUid = t.participantUids[idx];
    const otherEmail = t.participantEmails[idx];
    return isSupportByUid(supportUsers, otherUid) || isSupportByEmail(supportUsers, otherEmail);
  };

  // ---- thread list ----------------------------------------------------------
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return subscribeMyThreads(user.uid, setThreads);
  }, [user]);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeId) ?? null,
    [threads, activeId]
  );

  // ---- new chat picker ------------------------------------------------------
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerUsers, setPickerUsers] = useState<OtherUser[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");

  const openPicker = async () => {
    if (!user) return;
    setPickerOpen(true);
    setPickerLoading(true);
    try {
      const rows = await listOtherUsers(user.uid);
      setPickerUsers(rows);
    } catch (e: any) {
      toast({ title: "Couldn't load people", description: e?.message, variant: "destructive" });
    } finally {
      setPickerLoading(false);
    }
  };

  const startDmWith = async (other: OtherUser) => {
    if (!user || !profile) return;
    try {
      const id = await openOrCreateDmThread({
        selfUid: user.uid,
        selfEmail: profile.email,
        selfName: profile.displayName,
        otherUid: other.uid,
        otherEmail: other.email,
        otherName: other.displayName,
      });
      setActiveId(id);
      setPickerOpen(false);
    } catch (e: any) {
      toast({ title: "Couldn't open chat", description: e?.message, variant: "destructive" });
    }
  };

  const filteredPickerUsers = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return pickerUsers;
    return pickerUsers.filter(
      (u) =>
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
    );
  }, [pickerUsers, pickerSearch]);

  // ---- messages in active thread -------------------------------------------
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    // Pass selfUid so the subscription hydrates from localStorage and
    // write-throughs every snapshot — the failsafe layer (chatCache.ts).
    const unsub = subscribeThreadMessages(activeId, setMessages, user?.uid ?? null);
    // When this thread closes (or we switch to another), clear our
    // typing flag so the previous recipient doesn't see a stale "typing…".
    return () => {
      unsub();
      if (user) void clearTyping(activeId, user.uid);
    };
  }, [activeId, user]);

  // Auto-scroll to bottom when new messages arrive.
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, activeId]);

  // Snapshot of my readState[selfUid] at the moment this thread was opened —
  // used to draw the "New messages" divider above the first message that
  // arrived after my previous visit. Captured BEFORE we call markThreadRead,
  // so the divider stays put while the thread is open even though the
  // server-side readState gets bumped to "now" almost immediately.
  const [openedAtReadMs, setOpenedAtReadMs] = useState<number>(0);
  const lastSnapshottedThreadIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user || !activeId || !activeThread) return;
    if (lastSnapshottedThreadIdRef.current === activeId) return;
    lastSnapshottedThreadIdRef.current = activeId;
    setOpenedAtReadMs(activeThread.readState?.[user.uid]?.toMillis?.() ?? 0);
  }, [user, activeId, activeThread]);

  // Reset the snapshot key when the active thread changes so a re-open of
  // the same thread later in the session re-snapshots the new readState.
  useEffect(() => {
    return () => {
      lastSnapshottedThreadIdRef.current = null;
    };
  }, [activeId]);

  // Mark active thread as read whenever it opens or a new message lands.
  // Stamps `readState[selfUid]=now` on the thread doc so the unread count
  // in the sidebar/bottom-nav drops immediately for this user only.
  useEffect(() => {
    if (!user || !activeId) return;
    void markThreadRead(activeId, user.uid);
  }, [user, activeId, messages.length]);

  // Index of the first message (from someone else) newer than my previous
  // read timestamp. Used to position the "New messages" divider. -1 = no
  // unread boundary to render (fresh thread or all messages already seen).
  const newMessagesDividerIndex = useMemo(() => {
    if (!user || !openedAtReadMs) return -1;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.senderUid === user.uid) continue;
      const c = m.createdAt?.toMillis?.() ?? 0;
      if (c && c > openedAtReadMs) return i;
    }
    return -1;
  }, [messages, openedAtReadMs, user]);

  // Typing indicator freshness ticker — re-renders the header every 2s so
  // the "typing…" label decays without a Firestore round-trip when the
  // other user stops typing.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!activeId) return;
    const t = setInterval(() => setNowMs(Date.now()), 2_000);
    return () => clearInterval(t);
  }, [activeId]);
  const otherTyping = isOtherTyping(activeThread, user?.uid ?? "", nowMs);

  // ---- composer ------------------------------------------------------------
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Throttle typing pings: at most one Firestore write per ~3s while the
  // user is actively composing. Each ping refreshes our `typingState[uid]`
  // timestamp on the thread; consumers use TYPING_FRESH_MS (5s) freshness.
  const lastTypingPingRef = useRef(0);
  const TYPING_PING_INTERVAL_MS = Math.max(3_000, TYPING_FRESH_MS - 2_000);
  const handleDraftChange = (next: string) => {
    setDraft(next);
    if (!user || !activeId) return;
    if (!next.trim()) return; // empty draft = not typing
    const now = Date.now();
    if (now - lastTypingPingRef.current >= TYPING_PING_INTERVAL_MS) {
      lastTypingPingRef.current = now;
      void pingTyping(activeId, user.uid);
    }
  };
  const handleSend = async () => {
    if (!user || !profile || !activeId || !draft.trim()) return;
    setSending(true);
    try {
      await sendChatMessage({
        threadId: activeId,
        senderUid: user.uid,
        senderName: profile.displayName,
        senderEmail: profile.email,
        body: draft,
      });
      setDraft("");
      // Clear our typing flag immediately so the recipient's "typing…"
      // label disappears without waiting for the freshness window.
      lastTypingPingRef.current = 0;
      void clearTyping(activeId, user.uid);
    } catch (e: any) {
      toast({ title: "Couldn't send", description: e?.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  // ---- per-bubble edit / delete --------------------------------------------
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const beginEdit = (m: ChatMessage) => {
    setEditingId(m.id);
    setEditDraft(m.body);
  };
  const saveEdit = async () => {
    if (!activeId || !editingId) return;
    try {
      await editChatMessage({ threadId: activeId, messageId: editingId, newBody: editDraft });
      setEditingId(null);
      setEditDraft("");
    } catch (e: any) {
      toast({ title: "Edit failed", description: e?.message, variant: "destructive" });
    }
  };

  const deleteBubble = async (m: ChatMessage) => {
    if (!user || !activeId) return;
    try {
      await softDeleteChatMessage({
        threadId: activeId,
        messageId: m.id,
        moderatorUid: user.uid,
      });
      toast({ title: "Message removed" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  };

  const deleteThread = async () => {
    if (!user || !activeId) return;
    try {
      await archiveChatThread({ threadId: activeId, moderatorUid: user.uid });
      toast({ title: "Thread removed for everyone" });
      setActiveId(null);
    } catch (e: any) {
      toast({ title: "Couldn't remove thread", description: e?.message, variant: "destructive" });
    }
  };

  // ---- render --------------------------------------------------------------
  const otherParticipantLabel = (t: ChatThread): string => {
    if (!user) return "Chat";
    const idx = t.participantUids.findIndex((u) => u !== user.uid);
    if (idx < 0) return "Chat";
    return t.participantNames[idx] || t.participantEmails[idx] || "Teammate";
  };

  const showThreadPane = !isMobile || activeId === null;
  const showMessagePane = !isMobile || activeId !== null;

  // ---- read receipts -------------------------------------------------------
  // Compute the recipient's last-read timestamp (ms) and find the index of
  // the latest of *my* messages whose createdAt is <= that timestamp. We only
  // render "Seen" on that single bubble (Slack/iMessage style) so the UI
  // doesn't shout "Seen" under every line. Recomputed whenever messages or
  // the thread's readState change.
  const { seenAtMs, lastSeenOwnId } = useMemo(() => {
    if (!user || !activeThread) return { seenAtMs: 0, lastSeenOwnId: null as string | null };
    const otherUid = activeThread.participantUids.find((u) => u !== user.uid);
    if (!otherUid) return { seenAtMs: 0, lastSeenOwnId: null };
    const ms = activeThread.readState?.[otherUid]?.toMillis?.() ?? 0;
    if (!ms) return { seenAtMs: 0, lastSeenOwnId: null };
    let id: string | null = null;
    for (const m of messages) {
      if (m.senderUid !== user.uid) continue;
      if (m.deleted) continue;
      const c = m.createdAt?.toMillis?.() ?? 0;
      if (c && c <= ms) id = m.id;
    }
    return { seenAtMs: ms, lastSeenOwnId: id };
  }, [user, activeThread, messages]);

  return (
    <div className="flex h-full max-h-[calc(100vh-3.5rem)] md:max-h-screen">
      {showThreadPane && (
        <aside
          className={cn(
            "flex flex-col border-r border-border bg-card/40",
            isMobile ? "w-full" : "w-72 flex-shrink-0"
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border p-3">
            <h2 className="text-sm font-semibold text-foreground">Team Chat</h2>
            <Dialog open={pickerOpen} onOpenChange={(o) => (o ? openPicker() : setPickerOpen(false))}>
              <DialogTrigger asChild>
                <Button size="sm" variant="default" className="gap-1.5" onClick={openPicker}>
                  <MessageSquarePlus className="h-4 w-4" />
                  New
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Start a new chat</DialogTitle>
                  <DialogDescription>
                    Pick a teammate to open a direct message. Existing threads are reused.
                  </DialogDescription>
                </DialogHeader>
                <Input
                  autoFocus
                  placeholder="Search by name, email, or role…"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                />
                <ScrollArea className="max-h-72">
                  <div className="space-y-1 pr-2">
                    {pickerLoading && (
                      <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
                    )}
                    {!pickerLoading && filteredPickerUsers.length === 0 && (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        No teammates match.
                      </p>
                    )}
                    {!pickerLoading &&
                      filteredPickerUsers.map((u) => (
                        <button
                          key={u.uid}
                          onClick={() => startDmWith(u)}
                          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent"
                        >
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                            {u.displayName.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p className="truncate text-sm font-medium">{u.displayName}</p>
                              {(isSupportByUid(supportUsers, u.uid) || isSupportByEmail(supportUsers, u.email)) && (
                                <SupportBadge />
                              )}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {u.email} · {u.role}
                            </p>
                          </div>
                        </button>
                      ))}
                  </div>
                </ScrollArea>
              </DialogContent>
            </Dialog>
          </div>

          <ScrollArea className="flex-1">
            <div className="space-y-1 p-2">
              {threads.length === 0 && (
                <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                  No chats yet. Tap <span className="font-semibold">New</span> to message a teammate.
                </p>
              )}
              {threads.map((t) => {
                const label = otherParticipantLabel(t);
                const active = t.id === activeId;
                const unread = !!user && isThreadUnread(t, user.uid) && !active;
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveId(t.id)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors",
                      active ? "bg-accent" : "hover:bg-accent/50"
                    )}
                  >
                    <div className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {label.charAt(0).toUpperCase()}
                      {unread && (
                        <span
                          className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-card"
                          aria-label="Unread messages"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <p className={cn("truncate text-sm", unread ? "font-semibold text-foreground" : "font-medium")}>
                            {label}
                          </p>
                          {otherIsSupport(t) && <SupportBadge />}
                        </div>
                        <span className="flex-shrink-0 text-[10px] text-muted-foreground">
                          {t.lastMessageAt ? formatTime(t.lastMessageAt) : ""}
                        </span>
                      </div>
                      <p className={cn("truncate text-xs", unread ? "text-foreground" : "text-muted-foreground")}>
                        {t.lastMessagePreview || "No messages yet"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </aside>
      )}

      {showMessagePane && (
        <section className="flex flex-1 flex-col">
          {!activeThread && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
              <UsersIcon className="h-10 w-10 opacity-40" />
              <p className="text-sm">Select a chat from the list, or start a new one.</p>
            </div>
          )}
          {activeThread && (
            <>
              <header className="flex items-center justify-between gap-2 border-b border-border p-3">
                <div className="flex items-center gap-2 min-w-0">
                  {isMobile && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 flex-shrink-0"
                      onClick={() => setActiveId(null)}
                      aria-label="Back to chat list"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  )}
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {otherParticipantLabel(activeThread).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {otherParticipantLabel(activeThread)}
                      </p>
                      {otherIsSupport(activeThread) && <SupportBadge />}
                    </div>
                    {otherTyping ? (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span>typing</span>
                        <span className="flex items-end gap-0.5" aria-hidden="true">
                          <span className="block h-1 w-1 rounded-full bg-muted-foreground animate-typing-dot" style={{ animationDelay: "0ms" }} />
                          <span className="block h-1 w-1 rounded-full bg-muted-foreground animate-typing-dot" style={{ animationDelay: "150ms" }} />
                          <span className="block h-1 w-1 rounded-full bg-muted-foreground animate-typing-dot" style={{ animationDelay: "300ms" }} />
                        </span>
                      </span>
                    ) : (
                      <p className="truncate text-[11px] text-muted-foreground">
                        {activeThread.participantEmails.find((e) => e !== profile?.email) || ""}
                      </p>
                    )}
                  </div>
                </div>
                {isMod && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive gap-1.5">
                        <Trash2 className="h-4 w-4" />
                        Delete thread
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove this thread for everyone?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The thread will disappear from both participants' chat lists. Message
                          history is preserved server-side for audit, but no one will see it in
                          the app.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={deleteThread}>Remove thread</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </header>

              <ScrollArea className="flex-1 px-3 py-4">
                <div className="space-y-3">
                  {messages.map((m, idx) => {
                    const own = m.senderUid === user?.uid;
                    const isEditing = editingId === m.id;
                    const isDeleted = !!m.deleted;
                    const showDivider = idx === newMessagesDividerIndex;
                    return (
                      <React.Fragment key={m.id}>
                        {showDivider && (
                          <div className="flex items-center gap-2 py-1 animate-fade-in" aria-label="New messages">
                            <div className="h-px flex-1 bg-destructive/30" />
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-destructive/80">
                              New messages
                            </span>
                            <div className="h-px flex-1 bg-destructive/30" />
                          </div>
                        )}
                        <div
                          className={cn(
                            "group flex flex-col gap-1",
                            own ? "items-end" : "items-start"
                          )}
                        >
                        {!own && (
                          <span className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
                            {m.senderName}
                            {(isSupportByUid(supportUsers, m.senderUid) || isSupportByEmail(supportUsers, m.senderEmail)) && (
                              <SupportBadge />
                            )}
                          </span>
                        )}
                        <div
                          className={cn(
                            "relative max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                            own
                              ? "bg-primary text-primary-foreground rounded-br-sm"
                              : "bg-muted text-foreground rounded-bl-sm",
                            isDeleted && "italic opacity-60"
                          )}
                        >
                          {isDeleted ? (
                            <span>Message removed by a moderator</span>
                          ) : isEditing ? (
                            <div className="flex flex-col gap-2 min-w-[200px]">
                              <Textarea
                                autoFocus
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                rows={3}
                                className="text-sm bg-background text-foreground"
                              />
                              <div className="flex justify-end gap-1.5">
                                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                                  Cancel
                                </Button>
                                <Button size="sm" onClick={saveEdit} disabled={!editDraft.trim()}>
                                  Save
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <span className="whitespace-pre-wrap break-words">{m.body}</span>
                          )}
                        </div>
                        <div
                          className={cn(
                            "flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground",
                            own ? "flex-row-reverse" : ""
                          )}
                        >
                          <span>{formatTime(m.createdAt)}</span>
                          {m.editedAt && !isDeleted && (
                            <Badge variant="outline" className="h-4 px-1 py-0 text-[9px] font-normal">
                              edited
                            </Badge>
                          )}
                          {own && !isDeleted && lastSeenOwnId === m.id && (
                            <span
                              className="text-[10px] font-medium text-primary"
                              title={seenAtMs ? `Seen ${new Date(seenAtMs).toLocaleString()}` : "Seen"}
                            >
                              Seen
                            </span>
                          )}
                          {!isDeleted && !isEditing && (own || isMod) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:text-foreground"
                                  aria-label="Message actions"
                                >
                                  <MoreVertical className="h-3 w-3" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align={own ? "end" : "start"}>
                                {own && (
                                  <DropdownMenuItem onClick={() => beginEdit(m)}>
                                    <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                                  </DropdownMenuItem>
                                )}
                                {isMod && (
                                  <DropdownMenuItem
                                    onClick={() => deleteBubble(m)}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                        </div>
                      </React.Fragment>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              <footer className="border-t border-border p-3">
                <div className="flex items-end gap-2">
                  <Textarea
                    placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
                    value={draft}
                    onChange={(e) => handleDraftChange(e.target.value)}
                    onBlur={() => {
                      // Drop the typing flag immediately when the composer
                      // loses focus so the recipient doesn't see a stale
                      // "typing…" label after I tab away.
                      if (user && activeId) {
                        lastTypingPingRef.current = 0;
                        void clearTyping(activeId, user.uid);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    rows={2}
                    className="resize-none"
                  />
                  <Button onClick={handleSend} disabled={sending || !draft.trim()} className="gap-1.5">
                    <Send className="h-4 w-4" />
                    Send
                  </Button>
                </div>
              </footer>
            </>
          )}
        </section>
      )}
    </div>
  );
};

export default ChatPage;
