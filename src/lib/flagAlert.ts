/**
 * postFlagAlert — when a flagged term is detected in a sent message, this
 * captures a screenshot of the offending text and posts a Staff Update
 * (kind: "flag_alert") so the team sees it immediately.
 *
 * The Staff Updates collection allows webmaster-authored posts plus
 * auto-flag posts (any signed-in user) when kind === "flag_alert" — see
 * firestore.rules.
 */
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildTextScreenshotCard, captureElementAsDataUrl } from "@/lib/screenshot";

interface PostFlagAlertArgs {
  matches: string[];
  text: string;
  context: "conversation-reply" | "team-chat" | "customer-message";
  conversationId?: string;
  threadId?: string;
  authorUid: string;
  authorName: string;
  link?: string;
}

export async function postFlagAlert(args: PostFlagAlertArgs): Promise<void> {
  const { matches, text, context, conversationId, threadId, authorUid, authorName, link } = args;
  if (matches.length === 0) return;

  // Capture an off-screen card so the screenshot has predictable framing.
  const card = buildTextScreenshotCard({
    title: `${authorName} — ${labelForContext(context)}`,
    body: text,
    meta: `Flagged: ${matches.join(", ")}`,
  });
  const dataUrl = await captureElementAsDataUrl(card);
  card.remove();

  const summary = matches.length === 1
    ? `Flagged term "${matches[0]}"`
    : `Flagged terms: ${matches.slice(0, 4).join(", ")}${matches.length > 4 ? "…" : ""}`;

  await addDoc(collection(db, "staff_updates"), {
    kind: "flag_alert",
    title: `Auto-flag: ${summary}`,
    body: `${authorName} sent a message containing flagged language in ${labelForContext(context)}.\n\n"${text.slice(0, 600)}${text.length > 600 ? "…" : ""}"`,
    status: "ongoing",
    createdAt: serverTimestamp(),
    authorUid,
    authorName,
    screenshotDataUrl: dataUrl || null,
    matches,
    context,
    conversationId: conversationId || null,
    threadId: threadId || null,
    link: link || null,
  });
}

function labelForContext(c: PostFlagAlertArgs["context"]): string {
  switch (c) {
    case "conversation-reply": return "a customer conversation";
    case "team-chat": return "team chat";
    case "customer-message": return "an incoming customer message";
  }
}
