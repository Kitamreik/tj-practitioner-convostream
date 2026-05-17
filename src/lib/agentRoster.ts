/**
 * Agent Roster — verification source-of-truth used at signup.
 *
 * Schema (Firestore collection `agentRoster/{id}`):
 *   {
 *     legalName: string;          // matches against signup displayName
 *     preferredName?: string;     // optional friendly name
 *     aliases?: string[];         // additional accepted names
 *     email?: string | null;      // optional pre-registered email
 *     addedByUid: string;
 *     createdAt: serverTimestamp;
 *     updatedAt: serverTimestamp;
 *   }
 *
 * Firestore is the primary store (read/written by webmaster + admin).
 * `localStorage` caches the most recent snapshot so verification at signup
 * still works when offline or when Firestore reads are denied for an
 * un-authenticated session.
 *
 * Webmasters and admins can add/edit entries; everyone else only reads.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

const COLLECTION = "agentRoster";
const CACHE_KEY = "KitTJ.agentRoster.cache.v1";

export interface RosterEntry {
  id: string;
  legalName: string;
  preferredName?: string;
  aliases?: string[];
  email?: string | null;
  addedByUid?: string;
  createdAt?: { toDate?: () => Date } | null;
  updatedAt?: { toDate?: () => Date } | null;
}

export type RosterCreateInput = {
  legalName: string;
  preferredName?: string;
  aliases?: string[];
  email?: string;
};

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Read the local fallback snapshot. */
export function readRosterCache(): RosterEntry[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRosterCache(entries: RosterEntry[]): void {
  try {
    // Strip Firestore timestamps before serialising.
    const safe = entries.map((e) => ({
      id: e.id,
      legalName: e.legalName,
      preferredName: e.preferredName ?? "",
      aliases: e.aliases ?? [],
      email: e.email ?? null,
    }));
    localStorage.setItem(CACHE_KEY, JSON.stringify(safe));
  } catch {
    /* quota / privacy mode — ignore */
  }
}

/** Subscribe to roster changes; mirrors snapshots to localStorage. */
export function subscribeAgentRoster(
  cb: (entries: RosterEntry[]) => void
): () => void {
  const q = query(collection(db, COLLECTION), orderBy("legalName", "asc"));
  return onSnapshot(
    q,
    (snap) => {
      const rows: RosterEntry[] = snap.docs.map((d) => {
        const data = d.data() as Omit<RosterEntry, "id">;
        return { id: d.id, ...data };
      });
      writeRosterCache(rows);
      cb(rows);
    },
    (err) => {
      console.warn("subscribeAgentRoster error:", err);
      cb(readRosterCache());
    }
  );
}

export async function addRosterEntry(
  input: RosterCreateInput,
  addedByUid: string
): Promise<string> {
  const legalName = input.legalName.trim();
  if (!legalName) throw new Error("Legal name is required.");
  const ref = await addDoc(collection(db, COLLECTION), {
    legalName,
    preferredName: (input.preferredName ?? "").trim(),
    aliases: (input.aliases ?? [])
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, 10),
    email: (input.email ?? "").trim().toLowerCase() || null,
    addedByUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateRosterEntry(
  id: string,
  patch: Partial<RosterCreateInput>
): Promise<void> {
  const data: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.legalName !== undefined) data.legalName = patch.legalName.trim();
  if (patch.preferredName !== undefined)
    data.preferredName = patch.preferredName.trim();
  if (patch.aliases !== undefined)
    data.aliases = patch.aliases.map((a) => a.trim()).filter(Boolean).slice(0, 10);
  if (patch.email !== undefined)
    data.email = patch.email.trim().toLowerCase() || null;
  await updateDoc(doc(db, COLLECTION, id), data);
}

export async function removeRosterEntry(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}

/**
 * Verify a candidate displayName/email against the roster. Returns the
 * matching entry when found. Matches:
 *   - legalName (case-insensitive)
 *   - preferredName
 *   - any alias
 *   - email (when present on both sides)
 *
 * Uses Firestore snapshot if available (passed in), else falls back to the
 * localStorage cache so the check still works in offline / signed-out paths.
 */
export function verifyAgainstRoster(
  candidate: { displayName: string; email?: string },
  entries?: RosterEntry[]
): { matched: boolean; entry?: RosterEntry; matchedOn?: string } {
  const list = entries && entries.length > 0 ? entries : readRosterCache();
  if (list.length === 0) return { matched: false };
  const name = normalize(candidate.displayName);
  const email = candidate.email ? candidate.email.trim().toLowerCase() : null;

  for (const e of list) {
    if (email && e.email && normalize(e.email) === email) {
      return { matched: true, entry: e, matchedOn: "email" };
    }
    if (normalize(e.legalName) === name) {
      return { matched: true, entry: e, matchedOn: "legalName" };
    }
    if (e.preferredName && normalize(e.preferredName) === name) {
      return { matched: true, entry: e, matchedOn: "preferredName" };
    }
    if (e.aliases && e.aliases.some((a) => normalize(a) === name)) {
      return { matched: true, entry: e, matchedOn: "alias" };
    }
  }
  return { matched: false };
}
