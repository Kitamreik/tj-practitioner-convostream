/**
 * Live set of users with `supportAccess === true`, keyed by both uid and
 * (lower-cased) email so identity surfaces can match either way.
 *
 * Powers the small "Support" badge rendered next to display names in the
 * chat header / thread list / picker, the conversation assignee chip, and
 * the Settings agent table. Subscribed once at the providers layer; the
 * snapshot is small (one boolean field per user doc).
 *
 * Also includes the legacy `support@convohub.dev` email so accounts that
 * never had the explicit `supportAccess` flag flipped still light up — this
 * mirrors the rule used by `canModerateChat()` in `@/lib/chat`.
 */
import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { SUPPORT_EMAIL } from "@/lib/chat";

export interface SupportUserSet {
  /** Set of uids with supportAccess true. */
  uids: Set<string>;
  /** Set of lower-cased emails with supportAccess true (or legacy support email). */
  emails: Set<string>;
  /** Lower-cased display names with supportAccess true — best-effort match for assignee chips. */
  names: Set<string>;
}

const EMPTY: SupportUserSet = {
  uids: new Set(),
  emails: new Set([SUPPORT_EMAIL]),
  names: new Set(),
};

export function useSupportUsers(): SupportUserSet {
  const [data, setData] = useState<SupportUserSet>(EMPTY);

  useEffect(() => {
    const q = query(collection(db, "users"), where("supportAccess", "==", true));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const uids = new Set<string>();
        const emails = new Set<string>([SUPPORT_EMAIL]);
        const names = new Set<string>();
        snap.docs.forEach((d) => {
          const v = d.data() as { email?: string; displayName?: string };
          uids.add(d.id);
          if (v.email) emails.add(v.email.trim().toLowerCase());
          if (v.displayName) names.add(v.displayName.trim().toLowerCase());
        });
        setData({ uids, emails, names });
      },
      (err) => {
        console.warn("useSupportUsers snapshot failed:", err);
        setData(EMPTY);
      }
    );
    return unsub;
  }, []);

  return data;
}

/** Convenience helpers — case-insensitive, undefined-safe. */
export function isSupportByUid(set: SupportUserSet, uid: string | null | undefined): boolean {
  return !!uid && set.uids.has(uid);
}
export function isSupportByEmail(set: SupportUserSet, email: string | null | undefined): boolean {
  if (!email) return false;
  return set.emails.has(email.trim().toLowerCase());
}
export function isSupportByName(set: SupportUserSet, name: string | null | undefined): boolean {
  if (!name) return false;
  return set.names.has(name.trim().toLowerCase());
}
