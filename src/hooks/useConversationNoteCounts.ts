/**
 * useConversationNoteCounts — single shared listener that returns a map of
 * `conversationId → note count` for every conversation that currently has at
 * least one note.
 *
 * Implementation note: we use Firestore's `collectionGroup("notes")` so we
 * only pay for one snapshot stream, regardless of how many threads the user
 * is browsing. Counts are derived on the client by tallying parent IDs from
 * each doc's reference path — much cheaper than firing one listener per row.
 *
 * Returns `{}` while loading or when offline so callers can render
 * unconditionally without flicker.
 */
import { useEffect, useState } from "react";
import { collectionGroup, onSnapshot, query } from "firebase/firestore";
import { db } from "@/lib/firebase";

export function useConversationNoteCounts(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const q = query(collectionGroup(db, "notes"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: Record<string, number> = {};
        snap.docs.forEach((d) => {
          // Path: conversations/{convoId}/notes/{noteId}
          const parts = d.ref.path.split("/");
          const convosIdx = parts.indexOf("conversations");
          if (convosIdx === -1) return;
          const convoId = parts[convosIdx + 1];
          if (!convoId) return;
          next[convoId] = (next[convoId] ?? 0) + 1;
        });
        setCounts(next);
      },
      (err) => {
        // Permission/offline errors → silently render zero counts so the rest
        // of the UI still works. The full list view remains usable.
        console.warn("note count listener:", err);
        setCounts({});
      }
    );
    return unsub;
  }, []);

  return counts;
}
