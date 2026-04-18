/**
 * File Recording Vault — localStorage-backed store.
 *
 * Anyone can upload a recording (link to video + optional images as base64 +
 * arbitrary attachment links). Agents can append notes. Admins/webmasters can
 * edit, re-upload (replace fields), and delete entries. Status tags mirror
 * Staff Updates (ongoing / maintenance / resolved) so the team can flag
 * actionable recordings.
 *
 * Storage: localStorage under `convohub:fileRecordings:v1`. Pictures are
 * stored as small base64 data URLs (caller is responsible for keeping them
 * under a reasonable size). Videos are reference-only (URL).
 *
 * A lightweight index doc is also written to Firestore (`file_recordings`)
 * so we can fan-out notifications to other users — the canonical content
 * still lives in localStorage on the uploader's device.
 */

export type RecordingStatus = "ongoing" | "maintenance" | "resolved";

export interface RecordingNote {
  id: string;
  authorUid: string;
  authorName: string;
  body: string;
  createdAt: number;
}

export interface FileRecording {
  id: string;
  title: string;
  description: string;
  /** Optional video URL (Drive / YouTube / Dropbox / etc.). */
  videoUrl?: string;
  /** Additional reference links. */
  links: string[];
  /** Base64 image data URLs. Keep small. */
  images: string[];
  status: RecordingStatus;
  uploaderUid: string;
  uploaderName: string;
  uploaderRole: "agent" | "admin" | "webmaster";
  createdAt: number;
  updatedAt: number;
  notes: RecordingNote[];
}

const KEY = "convohub:fileRecordings:v1";

function read(): FileRecording[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FileRecording[]) : [];
  } catch (e) {
    console.warn("fileRecordings: failed to read storage:", e);
    return [];
  }
}

function write(list: FileRecording[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    // Notify any listeners in this tab — `storage` event only fires across tabs.
    window.dispatchEvent(new CustomEvent("file-recordings:changed"));
  } catch (e) {
    console.warn("fileRecordings: failed to write storage:", e);
    throw e;
  }
}

export function listRecordings(): FileRecording[] {
  return read().sort((a, b) => b.createdAt - a.createdAt);
}

export function getActiveCount(): number {
  return read().filter((r) => r.status !== "resolved").length;
}

export function addRecording(
  input: Omit<FileRecording, "id" | "createdAt" | "updatedAt" | "notes">
): FileRecording {
  const now = Date.now();
  const rec: FileRecording = {
    ...input,
    id: `rec_${now}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    notes: [],
  };
  const list = read();
  list.push(rec);
  write(list);
  return rec;
}

export function updateRecording(
  id: string,
  patch: Partial<Omit<FileRecording, "id" | "createdAt" | "notes">>
): FileRecording | null {
  const list = read();
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...patch, updatedAt: Date.now() };
  write(list);
  return list[idx];
}

export function deleteRecording(id: string): void {
  const list = read().filter((r) => r.id !== id);
  write(list);
}

export function addNote(
  recordingId: string,
  note: Omit<RecordingNote, "id" | "createdAt">
): FileRecording | null {
  const list = read();
  const idx = list.findIndex((r) => r.id === recordingId);
  if (idx < 0) return null;
  const newNote: RecordingNote = {
    ...note,
    id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
  };
  list[idx] = {
    ...list[idx],
    notes: [...list[idx].notes, newNote],
    updatedAt: Date.now(),
  };
  write(list);
  return list[idx];
}

export function deleteNote(recordingId: string, noteId: string): FileRecording | null {
  const list = read();
  const idx = list.findIndex((r) => r.id === recordingId);
  if (idx < 0) return null;
  list[idx] = {
    ...list[idx],
    notes: list[idx].notes.filter((n) => n.id !== noteId),
    updatedAt: Date.now(),
  };
  write(list);
  return list[idx];
}

/** Subscribe to storage changes (this tab via custom event, other tabs via storage event). */
export function subscribeRecordings(cb: () => void): () => void {
  const handler = () => cb();
  const storageHandler = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("file-recordings:changed", handler);
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener("file-recordings:changed", handler);
    window.removeEventListener("storage", storageHandler);
  };
}
