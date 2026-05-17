import React, { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ThumbsUp, ThumbsDown, Star } from "lucide-react";
import { rateMessage } from "@/lib/customerPortal";

interface ThreadMessage {
  id: string;
  body?: string;
  text?: string;
  senderUid?: string;
  senderRole?: string;
  direction?: "inbound" | "outbound";
  createdAt?: Timestamp;
  rating?: "up" | "down";
  ratingStars?: number | null;
  ratingNote?: string | null;
}

const PortalThread: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [convo, setConvo] = useState<{ customerName?: string; customerUid?: string } | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [followUpOpen, setFollowUpOpen] = useState<string | null>(null);
  const [followUpStars, setFollowUpStars] = useState(0);
  const [followUpNote, setFollowUpNote] = useState("");

  useEffect(() => {
    if (!id) return;
    const unsubC = onSnapshot(doc(db, "conversations", id), (snap) => {
      if (!snap.exists()) {
        navigate("/portal/conversations", { replace: true });
        return;
      }
      setConvo(snap.data() as { customerName?: string; customerUid?: string });
    });
    const q = query(
      collection(db, "conversations", id, "messages"),
      orderBy("createdAt", "asc"),
    );
    const unsubM = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ThreadMessage, "id">) })));
    });
    return () => {
      unsubC();
      unsubM();
    };
  }, [id, navigate]);

  const rate = async (msgId: string, rating: "up" | "down") => {
    if (!user || !id) return;
    try {
      await rateMessage(id, msgId, { rating, ratedByUid: user.uid });
      if (rating === "down") {
        setFollowUpOpen(msgId);
        setFollowUpStars(0);
        setFollowUpNote("");
      }
      toast({ title: rating === "up" ? "Thanks for the feedback" : "Thanks — what could be better?" });
    } catch (err: any) {
      toast({ title: "Could not save rating", description: err?.message, variant: "destructive" });
    }
  };

  const submitFollowUp = async (msgId: string) => {
    if (!user || !id) return;
    try {
      await rateMessage(id, msgId, {
        rating: "down",
        stars: followUpStars || undefined,
        note: followUpNote,
        ratedByUid: user.uid,
      });
      toast({ title: "Feedback recorded" });
      setFollowUpOpen(null);
    } catch (err: any) {
      toast({ title: "Could not save feedback", description: err?.message, variant: "destructive" });
    }
  };

  const isAgentReply = (m: ThreadMessage) =>
    m.direction === "outbound" || (m.senderRole && m.senderRole !== "customer");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/40">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/portal/conversations" className="gap-1">
              <ArrowLeft className="h-4 w-4" /> Back
            </Link>
          </Button>
          <h1 className="truncate text-lg font-semibold">
            {convo?.customerName || "Conversation"}
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          messages.map((m) => {
            const body = m.body || m.text || "";
            const agent = isAgentReply(m);
            return (
              <Card key={m.id} className={agent ? "" : "bg-muted/30"}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {agent ? "Support" : "You"}
                    {m.createdAt && (
                      <span className="ml-2 text-xs">
                        {m.createdAt.toDate().toLocaleString()}
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="whitespace-pre-wrap text-sm">{body}</p>
                  {agent && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant={m.rating === "up" ? "default" : "outline"}
                        size="sm"
                        onClick={() => rate(m.id, "up")}
                        aria-label="Helpful"
                      >
                        <ThumbsUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant={m.rating === "down" ? "default" : "outline"}
                        size="sm"
                        onClick={() => rate(m.id, "down")}
                        aria-label="Not helpful"
                      >
                        <ThumbsDown className="h-4 w-4" />
                      </Button>
                      {m.ratingStars ? (
                        <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                          {Array.from({ length: m.ratingStars }).map((_, i) => (
                            <Star key={i} className="h-3 w-3 fill-current" />
                          ))}
                        </span>
                      ) : null}
                    </div>
                  )}

                  {followUpOpen === m.id && (
                    <div className="space-y-2 rounded-md border border-border bg-background p-3">
                      <p className="text-xs font-medium">Optional: rate this reply</p>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setFollowUpStars(n)}
                            aria-label={`${n} star${n === 1 ? "" : "s"}`}
                          >
                            <Star
                              className={`h-5 w-5 ${
                                n <= followUpStars ? "fill-primary text-primary" : "text-muted-foreground"
                              }`}
                            />
                          </button>
                        ))}
                      </div>
                      <Textarea
                        placeholder="What could we improve?"
                        value={followUpNote}
                        onChange={(e) => setFollowUpNote(e.target.value)}
                        maxLength={1000}
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setFollowUpOpen(null)}>
                          Skip
                        </Button>
                        <Button size="sm" onClick={() => submitFollowUp(m.id)}>
                          Submit
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </main>
    </div>
  );
};

export default PortalThread;
