/**
 * Call Recording library — browser audio capture + Firebase Storage upload +
 * Firestore metadata.
 *
 * Storage layout:
 *   Storage:   call_recordings/{conversationId}/{recordingId}.webm
 *   Firestore: callRecordings/{recordingId} — metadata + analytics fields
 *
 * Compliance:
 *   - `consentGiven` boolean is required and stamped on the metadata doc.
 *   - Retention is enforced by the `appSettings/callRecordings` doc; a daily
 *     scheduled function (or manual purge) deletes recordings older than the
 *     configured number of days. The client never trusts the policy — it is
 *     also surfaced in the consent banner so agents know what to expect.
 */

import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  orderBy,
  limit as fbLimit,
  getDocs,
} from "firebase/firestore";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";

export interface CallRecordingDoc {
  id: string;
  conversationId: string;
  agentUid: string;
  agentName: string;
  storagePath: string;
  /** Deprecated: old public signed URL. New reads go through getCallRecordingDownloadUrl. */
  downloadUrl?: string;
  durationMs: number;
  /** Capture started (Date.now() ms). */
  startedAt: number;
  /** Capture stopped (Date.now() ms). */
  endedAt: number;
  consentGiven: boolean;
  /** Optional analytics: when the conversation actually opened (used for wait time). */
  conversationStartedAt?: number;
  /** When the conversation was marked resolved, if known at upload time. */
  resolvedAt?: number;
  /** Whether the conversation was resolved on the same call. */
  resolvedOnCall?: boolean;
  /** Bytes — for storage budgeting. */
  sizeBytes: number;
  /** ISO mime type returned by MediaRecorder. */
  mimeType: string;
  createdAt: Timestamp | null;
}

export interface RetentionPolicy {
  /** Days to keep recordings before purge. 0 = keep forever. */
  retentionDays: number;
  /** Whether the consent banner is required. */
  requireConsent: boolean;
  /** Custom consent banner text (optional). */
  consentText?: string;
  updatedAt?: Timestamp | null;
  updatedByUid?: string;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  retentionDays: 30,
  requireConsent: true,
  consentText:
    "This call may be recorded for quality assurance, training, and compliance. Recordings are stored securely and retained per the team's retention policy.",
};

const POLICY_DOC = ["appSettings", "callRecordings"] as const;

export async function getRetentionPolicy(): Promise<RetentionPolicy> {
  try {
    const snap = await getDoc(doc(db, ...POLICY_DOC));
    if (!snap.exists()) return DEFAULT_RETENTION;
    const data = snap.data() as Partial<RetentionPolicy>;
    return {
      retentionDays:
        typeof data.retentionDays === "number" ? data.retentionDays : DEFAULT_RETENTION.retentionDays,
      requireConsent:
        typeof data.requireConsent === "boolean" ? data.requireConsent : DEFAULT_RETENTION.requireConsent,
      consentText: data.consentText || DEFAULT_RETENTION.consentText,
      updatedAt: (data.updatedAt as Timestamp | undefined) ?? null,
      updatedByUid: data.updatedByUid,
    };
  } catch (e) {
    console.warn("getRetentionPolicy failed, using defaults:", e);
    return DEFAULT_RETENTION;
  }
}

export function subscribeRetentionPolicy(cb: (p: RetentionPolicy) => void): () => void {
  return onSnapshot(
    doc(db, ...POLICY_DOC),
    (snap) => {
      if (!snap.exists()) {
        cb(DEFAULT_RETENTION);
        return;
      }
      const data = snap.data() as Partial<RetentionPolicy>;
      cb({
        retentionDays:
          typeof data.retentionDays === "number" ? data.retentionDays : DEFAULT_RETENTION.retentionDays,
        requireConsent:
          typeof data.requireConsent === "boolean" ? data.requireConsent : DEFAULT_RETENTION.requireConsent,
        consentText: data.consentText || DEFAULT_RETENTION.consentText,
        updatedAt: (data.updatedAt as Timestamp | undefined) ?? null,
        updatedByUid: data.updatedByUid,
      });
    },
    () => cb(DEFAULT_RETENTION)
  );
}

export async function setRetentionPolicy(
  patch: Partial<Omit<RetentionPolicy, "updatedAt">>,
  byUid: string
): Promise<void> {
  await setDoc(
    doc(db, ...POLICY_DOC),
    {
      ...patch,
      updatedAt: serverTimestamp(),
      updatedByUid: byUid,
    },
    { merge: true }
  );
}

// -------------------- Recorder --------------------

export interface RecorderHandle {
  stop: () => Promise<Blob>;
  cancel: () => void;
  getStream: () => MediaStream;
  getStartedAt: () => number;
}

/**
 * Start an in-browser microphone recording. Uses MediaRecorder w/ a sensible
 * default mime type. Caller is responsible for prompting consent BEFORE
 * calling this — we don't double-gate here so the UI controls the message.
 */
export async function startRecording(): Promise<RecorderHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is not supported in this browser.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMimeType();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const startedAt = Date.now();
  recorder.start(1000); // gather chunks every second so a crash loses ≤1s

  let stopped = false;
  const stop = (): Promise<Blob> =>
    new Promise((resolve, reject) => {
      if (stopped) {
        reject(new Error("Recorder already stopped"));
        return;
      }
      stopped = true;
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
      };
      try {
        recorder.stop();
      } catch (e) {
        reject(e);
      }
    });

  const cancel = () => {
    if (stopped) return;
    stopped = true;
    try {
      recorder.stop();
    } catch {
      /* noop */
    }
    stream.getTracks().forEach((t) => t.stop());
  };

  return {
    stop,
    cancel,
    getStream: () => stream,
    getStartedAt: () => startedAt,
  };
}

function pickMimeType(): string | null {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  if (typeof MediaRecorder === "undefined") return null;
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

// -------------------- Upload + metadata --------------------

export interface UploadOpts {
  conversationId: string;
  agentUid: string;
  agentName: string;
  blob: Blob;
  startedAt: number;
  endedAt: number;
  consentGiven: boolean;
  conversationStartedAt?: number;
  resolvedAt?: number;
  resolvedOnCall?: boolean;
}

export async function uploadRecording(opts: UploadOpts): Promise<CallRecordingDoc> {
  const storage = getStorage();
  const ext = mimeToExt(opts.blob.type);
  const id = `rec_${opts.startedAt}_${Math.random().toString(36).slice(2, 8)}`;
  const path = `call_recordings/${opts.conversationId}/${id}.${ext}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, opts.blob, { contentType: opts.blob.type || "audio/webm" });

  const meta: Omit<CallRecordingDoc, "id" | "createdAt"> & { createdAt: ReturnType<typeof serverTimestamp> } = {
    conversationId: opts.conversationId,
    agentUid: opts.agentUid,
    agentName: opts.agentName,
    storagePath: path,
    downloadUrl: "",
    durationMs: Math.max(0, opts.endedAt - opts.startedAt),
    startedAt: opts.startedAt,
    endedAt: opts.endedAt,
    consentGiven: opts.consentGiven,
    conversationStartedAt: opts.conversationStartedAt,
    resolvedAt: opts.resolvedAt,
    resolvedOnCall: opts.resolvedOnCall,
    sizeBytes: opts.blob.size,
    mimeType: opts.blob.type || "audio/webm",
    createdAt: serverTimestamp(),
  };

  const docRef = await addDoc(collection(db, "callRecordings"), meta);
  return { ...(meta as unknown as CallRecordingDoc), id: docRef.id, createdAt: null };
}

function mimeToExt(mime: string): string {
  if (!mime) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

// -------------------- Queries for analytics --------------------

export async function listRecentRecordings(opts: {
  sinceMs?: number;
  agentUid?: string;
  max?: number;
}): Promise<CallRecordingDoc[]> {
  const max = opts.max ?? 500;
  const constraints: Parameters<typeof query>[1][] = [];
  if (opts.agentUid) constraints.push(where("agentUid", "==", opts.agentUid));
  if (opts.sinceMs) constraints.push(where("startedAt", ">=", opts.sinceMs));
  constraints.push(orderBy("startedAt", "desc"));
  constraints.push(fbLimit(max));
  const q = query(collection(db, "callRecordings"), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CallRecordingDoc, "id">) }));
}

export async function deleteRecording(rec: CallRecordingDoc): Promise<void> {
  const storage = getStorage();
  try {
    await deleteObject(storageRef(storage, rec.storagePath));
  } catch (e) {
    console.warn("deleteRecording: storage delete failed (continuing):", e);
  }
  await updateDoc(doc(db, "callRecordings", rec.id), {
    deletedAt: serverTimestamp(),
    downloadUrl: "",
  });
}

export async function getCallRecordingDownloadUrl(recordingId: string): Promise<string> {
  const fn = httpsCallable<{ recordingId: string }, { url: string }>(
    functions,
    "getCallRecordingDownloadUrl"
  );
  const res = await fn({ recordingId });
  return res.data.url;
}
