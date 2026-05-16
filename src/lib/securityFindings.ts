/**
 * Security findings & alerts — shared types, defaults, and Firestore helpers.
 *
 * Findings live in `security_findings/{id}` (webmaster-only). They represent
 * known security issues detected by Lovable's security scanner or by the
 * webmaster after manual review. Each finding tracks severity, the affected
 * collections, current status, and the last re-scan timestamp.
 *
 * Alerts live in `security_alerts/{id}` (append-only, webmaster-readable).
 * They represent runtime suspicious activity such as failed-login streaks or
 * attempts to set privilege flags from the client. Some alerts are emitted
 * server-side by Cloud Functions (e.g. `enforceUserRoleOnWrite`), some
 * client-side (failed sign-ins from `AuthContext.signIn`).
 */
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type Severity = "info" | "warn" | "error";
export type FindingStatus = "open" | "in_review" | "fixed" | "ignored";

export interface SecurityFinding {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  category: string;
  affectedCollections: string[];
  status: FindingStatus;
  /** Free-form notes from the webmaster who last reviewed/resolved it. */
  notes?: string;
  createdAt?: Timestamp | null;
  /** Last time a re-scan touched this finding (refreshed via "Re-scan now"). */
  lastScanAt?: Timestamp | null;
  /** When the finding flipped to `fixed`. */
  fixedAt?: Timestamp | null;
  /** UID of the webmaster who last updated the finding. */
  updatedBy?: string;
  updatedAt?: Timestamp | null;
}

export interface SecurityAlert {
  id: string;
  /** Stable kind so the UI can group + render. */
  kind:
    | "failed_login_streak"
    | "privilege_flag_strip"
    | "privilege_flag_revert"
    | "manual";
  severity: Severity;
  /** One-line headline for the alert. */
  summary: string;
  /** Subject email/uid if applicable. */
  subjectEmail?: string;
  subjectUid?: string;
  /** Structured detail blob — kept small (<2KB). */
  detail?: Record<string, unknown>;
  createdAt?: Timestamp | null;
}

/**
 * Seeded baseline findings — represent the two issues found by the
 * security scanner in this project's history. We write them once (idempotent)
 * the first time a webmaster visits the Security page so the dashboard isn't
 * empty before a real scan has been run.
 */
export const SEED_FINDINGS: Omit<SecurityFinding, "id">[] = [
  {
    title: "Users could self-grant chat moderation access at signup",
    description:
      "The users/{uid} create rule blocked escalatedAccess but not supportAccess. A user calling the Firestore SDK directly could write supportAccess: true at signup, gaining chat moderation powers.",
    severity: "warn",
    category: "Privilege Escalation",
    affectedCollections: ["users"],
    status: "fixed",
  },
  {
    title: "DM participant could add unauthorized users to private threads",
    description:
      "The chatThreads update rule let any participant modify any field, including participantUids. A participant could silently add UIDs and expose all historical DM messages.",
    severity: "warn",
    category: "Access Control Bypass",
    affectedCollections: ["chatThreads", "chatThreads/messages"],
    status: "fixed",
  },
];

/** Subscribe to all findings, newest first. */
export function subscribeFindings(
  cb: (rows: SecurityFinding[]) => void
): () => void {
  const q = query(collection(db, "security_findings"), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) =>
      cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SecurityFinding, "id">) }))),
    (err) => {
      console.warn("subscribeFindings error:", err);
      cb([]);
    }
  );
}

/** Subscribe to recent alerts (last 500). */
export function subscribeAlerts(cb: (rows: SecurityAlert[]) => void): () => void {
  const q = query(collection(db, "security_alerts"), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) =>
      cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SecurityAlert, "id">) }))),
    (err) => {
      console.warn("subscribeAlerts error:", err);
      cb([]);
    }
  );
}

export async function createFinding(
  input: Omit<SecurityFinding, "id" | "createdAt" | "updatedAt" | "lastScanAt">
): Promise<string> {
  const ref = await addDoc(collection(db, "security_findings"), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastScanAt: serverTimestamp(),
  });
  return ref.id;
}

export async function seedDefaultFindings(): Promise<void> {
  // Idempotent — uses deterministic IDs so re-runs no-op.
  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 64);
  await Promise.all(
    SEED_FINDINGS.map((f) =>
      setDoc(
        doc(db, "security_findings", `seed-${slug(f.title)}`),
        {
          ...f,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastScanAt: serverTimestamp(),
          fixedAt: f.status === "fixed" ? serverTimestamp() : null,
        },
        { merge: true }
      )
    )
  );
}

export async function updateFindingStatus(
  id: string,
  status: FindingStatus,
  notes: string | undefined,
  updatedBy: string
): Promise<void> {
  await updateDoc(doc(db, "security_findings", id), {
    status,
    notes: notes ?? "",
    updatedBy,
    updatedAt: serverTimestamp(),
    ...(status === "fixed" ? { fixedAt: serverTimestamp() } : {}),
  });
}

/**
 * Stamp every finding's `lastScanAt` to now. Used by the "Re-scan now"
 * button — actual server-side scanning lives in Lovable's security tooling;
 * this just records that the webmaster acknowledged a fresh review.
 */
export async function stampRescan(findings: SecurityFinding[]): Promise<void> {
  await Promise.all(
    findings.map((f) =>
      updateDoc(doc(db, "security_findings", f.id), {
        lastScanAt: serverTimestamp(),
      }).catch(() => undefined)
    )
  );
}

export async function postAlert(
  alert: Omit<SecurityAlert, "id" | "createdAt">
): Promise<void> {
  try {
    await addDoc(collection(db, "security_alerts"), {
      ...alert,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    // Alerts are best-effort — never block the user flow.
    console.warn("postAlert failed:", e);
  }
}

/** Render a Firestore Timestamp as a locale string. */
export function fmtTs(ts: Timestamp | null | undefined): string {
  const ms = ts?.toMillis?.();
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  info: "Info",
  warn: "Warning",
  error: "Critical",
};

export const STATUS_LABEL: Record<FindingStatus, string> = {
  open: "Open",
  in_review: "In review",
  fixed: "Fixed",
  ignored: "Ignored",
};
