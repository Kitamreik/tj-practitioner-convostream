/**
 * Document upload pipeline for conversations.
 *
 * 1. Extracts text from the file (PDF/DOCX/text) using extractDocText.
 * 2. Runs PII + name + location masking on the extracted text.
 * 3. Writes a system message into the conversation with the masked summary.
 * 4. Uploads the raw bytes to Firebase Storage under
 *    `conversation-uploads/{conversationId}/...` with a `deleteAt` custom
 *    metadata stamp set to +6h. The `purgeConversationUploads` scheduled
 *    Cloud Function deletes anything past that mark.
 *
 * No LLM is invoked — the "summary" is a strictly bounded slice of the
 * masked source text, with detected-redaction counts surfaced for the agent.
 */
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import { addDoc, collection, serverTimestamp, Timestamp } from "firebase/firestore";
import app, { db } from "@/lib/firebase";
import { extractDocText, ExtractDocError } from "@/lib/extractDocText";
import { buildExtractedContext, maskSensitive } from "@/lib/piiMask";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export interface ConvoUploadInput {
  conversationId: string;
  file: File;
  agent: { uid: string; displayName: string };
}

export interface ConvoUploadResult {
  storagePath: string;
  deleteAt: Date;
  summary: string;
  messageId: string;
}

export async function uploadConversationDocument(
  input: ConvoUploadInput,
): Promise<ConvoUploadResult> {
  const { conversationId, file, agent } = input;

  // 1) Extract — surface any error verbatim so the user sees a clear hint.
  const extracted = await extractDocText(file).catch((e) => {
    if (e instanceof ExtractDocError) throw e;
    throw new ExtractDocError(e?.message || "Could not read this file.");
  });

  // 2) Mask.
  const masked = maskSensitive(extracted.text);
  const summary = buildExtractedContext(masked, extracted.sourceName);

  // 3) Upload bytes with a 6-hour TTL marker.
  const storage = getStorage(app);
  const deleteAt = new Date(Date.now() + SIX_HOURS_MS);
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `conversation-uploads/${conversationId}/${Date.now()}-${safeName}`;
  const objectRef = storageRef(storage, path);
  await uploadBytes(objectRef, file, {
    contentType: file.type || "application/octet-stream",
    customMetadata: {
      conversationId,
      uploaderUid: agent.uid,
      deleteAt: String(deleteAt.getTime()),
    },
  });

  // 4) System message in the thread with masked context.
  const msg = await addDoc(collection(db, "conversations", conversationId, "messages"), {
    conversationId,
    sender: "system",
    senderRole: "system",
    text: summary,
    kind: "document-context",
    sourceName: extracted.sourceName,
    storagePath: path,
    redactionCounts: masked.counts,
    timestamp: serverTimestamp(),
    agentName: agent.displayName,
    autoDeleteAt: Timestamp.fromDate(deleteAt),
  });

  return { storagePath: path, deleteAt, summary, messageId: msg.id };
}
