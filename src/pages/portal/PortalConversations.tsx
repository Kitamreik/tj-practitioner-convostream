import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LogOut, MessageCircle, ChevronRight } from "lucide-react";

interface CustomerConversation {
  id: string;
  customerName?: string;
  lastMessage?: string;
  updatedAt?: Timestamp;
  status?: string;
  unreadByCustomer?: number;
}

const PortalConversations: React.FC = () => {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<CustomerConversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    // Primary query: conversations stamped with our uid. Fallback (handled
    // by signup/sign-in claim helper) backfills uid on first login.
    const q = query(
      collection(db, "conversations"),
      where("customerUid", "==", user.uid),
      orderBy("updatedAt", "desc"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CustomerConversation, "id">) })),
        );
        setLoading(false);
      },
      (err) => {
        console.error("Customer conversation subscription failed:", err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [user]);

  const greeting = useMemo(() => {
    const name = profile?.displayName?.split(" ")[0] || "there";
    return `Welcome back, ${name}`;
  }, [profile]);

  const onSignOut = async () => {
    await signOut();
    navigate("/portal/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/40">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
              <MessageCircle className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">{greeting}</h1>
              <p className="text-xs text-muted-foreground">{profile?.email}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onSignOut} className="gap-2">
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h2 className="mb-4 text-xl font-semibold">Your conversations</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No conversations yet. Once you reach out via the chat widget or email,
              your threads will appear here.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {rows.map((c) => (
              <li key={c.id}>
                <Link to={`/portal/conversations/${c.id}`}>
                  <Card className="transition-colors hover:bg-muted/40">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-base">
                        {c.customerName || "Conversation"}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        {c.unreadByCustomer ? (
                          <Badge>{c.unreadByCustomer} new</Badge>
                        ) : null}
                        {c.status && c.status !== "open" ? (
                          <Badge variant="outline">{c.status}</Badge>
                        ) : null}
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0 text-sm text-muted-foreground">
                      <p className="line-clamp-2">{c.lastMessage || "Tap to view thread"}</p>
                      {c.updatedAt && (
                        <p className="mt-2 text-xs">
                          Updated {c.updatedAt.toDate().toLocaleString()}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
};

export default PortalConversations;
