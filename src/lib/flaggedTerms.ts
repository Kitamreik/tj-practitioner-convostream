/**
 * Flagged terms registry — expletives + abusive language patterns that should
 * raise an alert in Staff Updates when an agent or customer sends a message
 * containing them.
 *
 * The canonical list lives in Firestore (`flagged_terms/{id}` with field
 * `term`), editable by webmasters via the Staff Updates page. We seed and
 * fall back to a curated default list below so detection still works before
 * the collection is populated.
 *
 * Matching is case-insensitive and uses whole-word boundaries to avoid
 * false-positives on substrings (e.g. "class" vs "ass").
 */
import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

// Defaults are intentionally mild profanity + classic abusive slurs.
// Webmasters can extend this list at runtime without a redeploy.
export const DEFAULT_FLAGGED_TERMS: string[] = [
  // expletives
  "fuck", "fucking", "fucker", "motherfucker",
  "shit", "bullshit", "shitty",
  "bitch", "bitches", "asshole", "ass",
  "bastard", "damn", "dammit", "goddamn",
  "crap", "piss", "pissed",
  "dick", "dickhead", "cock", "prick",
  "cunt", "twat", "wanker",
  // slurs / abusive
  "idiot", "moron", "stupid", "dumbass", "retard", "retarded",
  "loser", "scum", "trash",
  // threats / escalation triggers
  "kill you", "kill yourself", "kys", "die",
  "lawsuit", "sue you", "report you",
  "screw you", "shut up",
];

export interface FlaggedTerm {
  id: string;
  term: string;
  severity?: "low" | "medium" | "high";
  createdAt?: any;
  createdBy?: string;
}

export function useFlaggedTerms(): { terms: string[]; docs: FlaggedTerm[]; loading: boolean } {
  const [docs, setDocs] = useState<FlaggedTerm[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const q = query(collection(db, "flagged_terms"), orderBy("term"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setDocs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);
  const fromFirestore = docs.map((d) => d.term).filter(Boolean);
  const merged = Array.from(
    new Set([...fromFirestore, ...DEFAULT_FLAGGED_TERMS].map((t) => t.toLowerCase().trim()))
  ).filter(Boolean);
  return { terms: merged, docs, loading };
}

export async function addFlaggedTerm(term: string, severity: FlaggedTerm["severity"] = "medium", uid?: string) {
  const t = term.trim().toLowerCase();
  if (!t) throw new Error("Term required");
  await addDoc(collection(db, "flagged_terms"), {
    term: t,
    severity,
    createdAt: serverTimestamp(),
    createdBy: uid || null,
  });
}

export async function removeFlaggedTerm(id: string) {
  await deleteDoc(doc(db, "flagged_terms", id));
}

/**
 * Scan `text` against `terms` and return every match (lowercased, deduped).
 * Empty array means "clean".
 */
export function detectFlaggedTerms(text: string, terms: string[]): string[] {
  if (!text || terms.length === 0) return [];
  const lower = text.toLowerCase();
  const hits = new Set<string>();
  for (const t of terms) {
    if (!t) continue;
    // Escape regex meta and use word-boundary matching so "ass" doesn't hit "class".
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    if (re.test(lower)) hits.add(t);
  }
  return Array.from(hits);
}
