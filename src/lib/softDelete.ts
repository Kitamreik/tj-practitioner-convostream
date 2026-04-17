import { Timestamp, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export const ARCHIVE_RETENTION_DAYS = 30;

export interface Archivable {
  archived?: boolean;
  deletedAt?: Timestamp | { toDate: () => Date } | null;
}

export function isExpired(deletedAt: any): boolean {
  if (!deletedAt?.toDate) return false;
  const ageMs = Date.now() - deletedAt.toDate().getTime();
  return ageMs > ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

export function daysRemaining(deletedAt: any): number {
  if (!deletedAt?.toDate) return ARCHIVE_RETENTION_DAYS;
  const ageMs = Date.now() - deletedAt.toDate().getTime();
  const remaining = ARCHIVE_RETENTION_DAYS - Math.floor(ageMs / (24 * 60 * 60 * 1000));
  return Math.max(0, remaining);
}

export function isArchived(item: Archivable): boolean {
  return !!item.archived;
}

/**
 * Restore a soft-deleted item by clearing its `archived` + `deletedAt` fields.
 * Used by undo toasts and the Archive page.
 */
export async function restoreItem(
  collectionName: "conversations" | "people",
  id: string
): Promise<void> {
  await updateDoc(doc(db, collectionName, id), { archived: false, deletedAt: null });
}

