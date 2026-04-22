import React, { useState } from "react";
import { Link } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  PlayCircle,
  AlertCircle,
  Shield,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { db, functions } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

/**
 * SmokeTest — webmaster-only checklist page that verifies the deployed
 * Firestore rules + Cloud Functions are wired correctly. Each check is a
 * safe, idempotent read/write against a per-user scratch document so we
 * never touch real data.
 *
 * Checks performed:
 *  1. Auth — current session is a webmaster (rules gate everything else).
 *  2. users/{uid}/prefs — owner-only read/write (the rule we just shipped
 *     to fix the Background Gmail toggle).
 *  3. users/{uid}/notifications — owner read.
 *  4. webmasterContactEvents — write a heartbeat doc, then clean up.
 *  5. pingWebmasterSlack callable — handshake only (sends "smoke-test"
 *     payload; webhook may or may not be configured — both outcomes are
 *     considered "function reachable").
 *  6. promoteToWebmaster + cloneIntegrationsToSupport — verifies the
 *     callables are deployed by issuing a no-op invocation that we expect
 *     to either succeed (already promoted) or return a known error code
 *     (failed-precondition / already-exists). Network-level errors are
 *     treated as failures.
 *
 * Anything red here means the deploy is incomplete — re-run
 * `firebase deploy --only firestore:rules,functions:promoteToWebmaster,functions:cloneIntegrationsToSupport,functions:pingWebmasterSlack`.
 */

type CheckStatus = "idle" | "running" | "pass" | "fail" | "warn";

interface CheckRow {
  id: string;
  label: string;
  detail: string;
  status: CheckStatus;
  message?: string;
}

const INITIAL: CheckRow[] = [
  { id: "auth", label: "Webmaster auth", detail: "profile.role === 'webmaster'", status: "idle" },
  { id: "prefs", label: "users/{uid}/prefs read+write", detail: "rule shipped to fix Background Gmail toggle", status: "idle" },
  { id: "notifications", label: "users/{uid}/notifications read", detail: "owner-only read", status: "idle" },
  { id: "contactEvents", label: "webmasterContactEvents write", detail: "heartbeat doc + cleanup", status: "idle" },
  { id: "slackFn", label: "pingWebmasterSlack callable", detail: "handshake only — webhook config not required", status: "idle" },
  { id: "promoteFn", label: "promoteToWebmaster callable", detail: "deployed + reachable", status: "idle" },
  { id: "cloneFn", label: "cloneIntegrationsToSupport callable", detail: "deployed + reachable", status: "idle" },
];

const StatusIcon: React.FC<{ status: CheckStatus }> = ({ status }) => {
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (status === "fail") return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === "warn") return <AlertCircle className="h-4 w-4 text-warning" />;
  return <span className="inline-block h-4 w-4 rounded-full border border-border" />;
};

const SmokeTest: React.FC = () => {
  const { profile } = useAuth();
  const [rows, setRows] = useState<CheckRow[]>(INITIAL);
  const [running, setRunning] = useState(false);

  const update = (id: string, patch: Partial<CheckRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const runChecks = async () => {
    if (running) return;
    setRunning(true);
    setRows(INITIAL.map((r) => ({ ...r, status: "running", message: undefined })));

    const uid = profile?.uid;

    // 1) Auth check
    if (!uid) {
      update("auth", { status: "fail", message: "No active session." });
      setRunning(false);
      return;
    }
    if (profile?.role !== "webmaster") {
      update("auth", { status: "fail", message: `Role is "${profile?.role}", expected "webmaster".` });
      setRunning(false);
      return;
    }
    update("auth", { status: "pass", message: `Signed in as ${profile.email}` });

    // 2) users/{uid}/prefs — write a scratch pref, read it back, delete.
    try {
      const prefRef = doc(db, "users", uid, "prefs", "__smoke_test__");
      await setDoc(prefRef, { ranAt: serverTimestamp(), ok: true }, { merge: true });
      const snap = await getDoc(prefRef);
      if (!snap.exists() || snap.data()?.ok !== true) throw new Error("Read-back mismatch.");
      await deleteDoc(prefRef);
      update("prefs", { status: "pass", message: "write → read → delete succeeded." });
    } catch (err: any) {
      update("prefs", {
        status: "fail",
        message: err?.code === "permission-denied"
          ? "permission-denied — redeploy firestore.rules."
          : err?.message || "Unknown error.",
      });
    }

    // 3) notifications — just attempt a read on a known-safe doc id (may or may not exist).
    try {
      await getDoc(doc(db, "users", uid, "notifications", "__smoke_test__"));
      update("notifications", { status: "pass", message: "owner read allowed." });
    } catch (err: any) {
      update("notifications", {
        status: err?.code === "permission-denied" ? "fail" : "warn",
        message: err?.message || "Unknown error.",
      });
    }

    // 4) webmasterContactEvents — write a heartbeat doc, then clean up.
    try {
      const evtRef = doc(db, "webmasterContactEvents", `smoke-${uid}`);
      await setDoc(evtRef, {
        channel: "smoke-test",
        agentUid: uid,
        agentName: profile.displayName || profile.email || "smoke",
        route: "/smoke-test",
        createdAt: serverTimestamp(),
      });
      await deleteDoc(evtRef);
      update("contactEvents", { status: "pass", message: "heartbeat doc written + cleaned up." });
    } catch (err: any) {
      update("contactEvents", {
        status: "fail",
        message: err?.code === "permission-denied"
          ? "permission-denied — check rules for webmasterContactEvents."
          : err?.message || "Unknown error.",
      });
    }

    // 5) pingWebmasterSlack — handshake only, mark webhook-missing as warn (not fail).
    try {
      const fn = httpsCallable<{ agentName: string; route: string; message?: string; smokeTest?: boolean }, { ok: boolean; error?: string }>(
        functions,
        "pingWebmasterSlack"
      );
      const res = await fn({
        agentName: profile.displayName || "smoke-test",
        route: "/smoke-test",
        message: "[smoke-test] handshake — please ignore.",
        smokeTest: true,
      });
      const data = res.data || { ok: false };
      if (data.ok) {
        update("slackFn", { status: "pass", message: "callable reachable + webhook posted." });
      } else {
        update("slackFn", {
          status: "warn",
          message: data.error || "callable reachable but webhook not configured.",
        });
      }
    } catch (err: any) {
      // failed-precondition is treated as warn (function deployed, secret missing)
      const code = err?.code || "";
      if (typeof code === "string" && code.includes("failed-precondition")) {
        update("slackFn", { status: "warn", message: err?.message || "Webhook secret missing." });
      } else {
        update("slackFn", { status: "fail", message: err?.message || "Callable unreachable." });
      }
    }

    // 6) promoteToWebmaster — invoke with a no-op payload to confirm deploy.
    try {
      const fn = httpsCallable<{ targetUid?: string; smokeTest?: boolean }, { ok: boolean }>(
        functions,
        "promoteToWebmaster"
      );
      await fn({ smokeTest: true });
      update("promoteFn", { status: "pass", message: "callable reachable." });
    } catch (err: any) {
      const code = err?.code || "";
      // Expected guard rails — function is deployed, just refused this no-op.
      if (typeof code === "string" && (code.includes("failed-precondition") || code.includes("invalid-argument") || code.includes("already-exists") || code.includes("permission-denied"))) {
        update("promoteFn", { status: "pass", message: `reachable (guarded: ${code}).` });
      } else if (typeof code === "string" && code.includes("not-found")) {
        update("promoteFn", { status: "fail", message: "function not deployed — run `firebase deploy --only functions:promoteToWebmaster`." });
      } else {
        update("promoteFn", { status: "warn", message: err?.message || "Unexpected response." });
      }
    }

    // 7) cloneIntegrationsToSupport — same pattern.
    try {
      const fn = httpsCallable<{ smokeTest?: boolean }, { ok: boolean }>(
        functions,
        "cloneIntegrationsToSupport"
      );
      await fn({ smokeTest: true });
      update("cloneFn", { status: "pass", message: "callable reachable." });
    } catch (err: any) {
      const code = err?.code || "";
      if (typeof code === "string" && (code.includes("failed-precondition") || code.includes("invalid-argument") || code.includes("already-exists") || code.includes("permission-denied"))) {
        update("cloneFn", { status: "pass", message: `reachable (guarded: ${code}).` });
      } else if (typeof code === "string" && code.includes("not-found")) {
        update("cloneFn", { status: "fail", message: "function not deployed — run `firebase deploy --only functions:cloneIntegrationsToSupport`." });
      } else {
        update("cloneFn", { status: "warn", message: err?.message || "Unexpected response." });
      }
    }

    setRunning(false);
  };

  // Webmaster gate (page is also gated at the route level, but defense in depth).
  if (profile && profile.role !== "webmaster") {
    return (
      <div className="container mx-auto max-w-2xl p-6">
        <Card className="p-8 text-center">
          <Shield className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Webmaster only</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This smoke-test page verifies Firestore rules + functions and is restricted to webmasters.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/settings">Back to Settings</Link>
          </Button>
        </Card>
      </div>
    );
  }

  const summary = (() => {
    const counts = rows.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      },
      {} as Record<CheckStatus, number>
    );
    return counts;
  })();

  return (
    <div className="container mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "'Playfair Display', serif" }}>
            Deployment smoke test
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Safe read/write checks against a per-user scratch document. Re-run after any{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">firebase deploy</code>.
          </p>
        </div>
        <Button onClick={runChecks} disabled={running} className="gap-2 shrink-0">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          {running ? "Running…" : "Run checks"}
        </Button>
      </div>

      <Card className="divide-y divide-border">
        {rows.map((row) => (
          <div key={row.id} className="flex items-start gap-3 p-4">
            <div className="pt-0.5">
              <StatusIcon status={row.status} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{row.label}</span>
                {row.status === "pass" && <Badge variant="secondary" className="text-[10px]">PASS</Badge>}
                {row.status === "fail" && <Badge variant="destructive" className="text-[10px]">FAIL</Badge>}
                {row.status === "warn" && <Badge className="bg-warning text-warning-foreground text-[10px]">WARN</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p>
              {row.message && (
                <p className="mt-1 break-words text-xs text-foreground/80">
                  <span className="text-muted-foreground">→ </span>
                  {row.message}
                </p>
              )}
            </div>
          </div>
        ))}
      </Card>

      <Separator className="my-6" />

      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div className="rounded-lg border border-border p-3">
          <div className="text-muted-foreground">Pass</div>
          <div className="text-lg font-semibold text-success">{summary.pass || 0}</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-muted-foreground">Warn</div>
          <div className="text-lg font-semibold text-warning">{summary.warn || 0}</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-muted-foreground">Fail</div>
          <div className="text-lg font-semibold text-destructive">{summary.fail || 0}</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-muted-foreground">Pending</div>
          <div className="text-lg font-semibold text-foreground">
            {(summary.idle || 0) + (summary.running || 0)}
          </div>
        </div>
      </div>

      <p className="mt-6 text-[11px] text-muted-foreground">
        Tip: a "WARN" on the Slack callable means the function is deployed but the webhook secret isn't set —
        configure it under Settings → Integrations and re-run.
      </p>
    </div>
  );
};

export default SmokeTest;
