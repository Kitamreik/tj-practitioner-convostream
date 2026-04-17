import { Timestamp } from "firebase/firestore";

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
