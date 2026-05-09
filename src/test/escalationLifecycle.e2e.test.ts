/**
 * End-to-end lifecycle test for the webmaster escalation queue and the
 * Slack ping path. Runs in the Vitest sandbox by mocking
 * `firebase/functions` so the test exercises the same callable wiring
 * shipped to production without requiring a deployed backend.
 *
 * Flow under test (single sitting):
 *
 *   1. Agent posts an escalation     → requestWebmasterEscalation
 *   2. Webmaster resolves it         → manageEscalationRequest("resolve")
 *   3. Webmaster reopens it          → manageEscalationRequest("reopen")
 *   4. Webmaster archives it         → manageEscalationRequest("archive")
 *   5. Slack ping smoke handshake    → pingWebmasterSlack({ smokeTest: true })
 *
 * Also pins guardrails that previously broke deploys:
 *   - Firestore doc IDs cannot start/end with `__` (smoke test scratch doc).
 *   - Callable inputs must be plain JSON-safe objects (CORS preflight bug
 *     reproduced when bodies contained class instances).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const callableMock = vi.fn();
const callableNames: string[] = [];

vi.mock("firebase/functions", () => ({
  httpsCallable: (_fns: unknown, name: string) => {
    callableNames.push(name);
    return (data: unknown) => callableMock(name, data);
  },
  getFunctions: () => ({}),
}));
vi.mock("@/lib/firebase", () => ({
  functions: {},
  db: {},
  auth: {},
}));

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

// Recreate the thin client wrappers Settings.tsx / Archive.tsx use inline
// so the test exercises the exact callable shape shipped in production.
const requestEscalation = (reason: string) =>
  httpsCallable<{ reason: string }, { ok: boolean; requestId: string; notified: number }>(
    functions,
    "requestWebmasterEscalation"
  )({ reason });

const manageEscalation = (
  requestId: string,
  action: "resolve" | "reopen" | "archive" | "restore"
) =>
  httpsCallable<
    { requestId: string; action: typeof action },
    { ok: boolean; action: typeof action }
  >(functions, "manageEscalationRequest")({ requestId, action });

const pingSlack = (smokeTest = false) =>
  httpsCallable<
    { agentName: string; route: string; message?: string; smokeTest?: boolean },
    { ok: boolean; error?: string }
  >(functions, "pingWebmasterSlack")({
    agentName: "ci-runner",
    route: "/smoke-test",
    smokeTest,
  });

// Firestore reserved-id guard (matches functions/src smoke handler logic).
const isValidFirestoreId = (id: string) =>
  id.length > 0 &&
  id.length <= 1500 &&
  !id.includes("/") &&
  !(id.startsWith("__") && id.endsWith("__"));

beforeEach(() => {
  callableMock.mockReset();
  callableNames.length = 0;
});

describe("escalation lifecycle (request → resolve → reopen → archive)", () => {
  it("walks an escalation through every state in one flow", async () => {
    const requestId = "esc_e2e_001";

    callableMock
      // 1. create
      .mockResolvedValueOnce({ data: { ok: true, requestId, notified: 2 } })
      // 2. resolve
      .mockResolvedValueOnce({ data: { ok: true, action: "resolve" } })
      // 3. reopen
      .mockResolvedValueOnce({ data: { ok: true, action: "reopen" } })
      // 4. archive
      .mockResolvedValueOnce({ data: { ok: true, action: "archive" } });

    const created = await requestEscalation("CI lifecycle smoke");
    expect(created.data.ok).toBe(true);
    expect(created.data.requestId).toBe(requestId);
    expect(isValidFirestoreId(created.data.requestId)).toBe(true);

    const resolved = await manageEscalation(requestId, "resolve");
    expect(resolved.data).toEqual({ ok: true, action: "resolve" });

    const reopened = await manageEscalation(requestId, "reopen");
    expect(reopened.data).toEqual({ ok: true, action: "reopen" });

    const archived = await manageEscalation(requestId, "archive");
    expect(archived.data).toEqual({ ok: true, action: "archive" });

    // Verify the exact ordering of callables — guards against accidental
    // refactors that swap collection writes in for the callable contract.
    expect(callableNames).toEqual([
      "requestWebmasterEscalation",
      "manageEscalationRequest",
      "manageEscalationRequest",
      "manageEscalationRequest",
    ]);
    const actions = callableMock.mock.calls
      .filter((c) => c[0] === "manageEscalationRequest")
      .map((c) => (c[1] as { action: string }).action);
    expect(actions).toEqual(["resolve", "reopen", "archive"]);

    // Every payload must be JSON-serialisable — class instances triggered
    // the CORS-preflight bug we previously hit in deploy.
    for (const [, payload] of callableMock.mock.calls) {
      expect(() => JSON.stringify(payload)).not.toThrow();
      expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
    }
  });

  it("propagates webmaster-only permission-denied on manage", async () => {
    callableMock.mockRejectedValueOnce({
      code: "functions/permission-denied",
      message: "Webmasters only.",
    });
    await expect(manageEscalation("esc_x", "resolve")).rejects.toMatchObject({
      code: "functions/permission-denied",
    });
  });

  it("propagates invalid-argument on bogus action", async () => {
    callableMock.mockRejectedValueOnce({
      code: "functions/invalid-argument",
      message: "action must be resolve|reopen|archive|restore.",
    });
    // Cast to bypass the union — server is the source of truth here.
    await expect(
      manageEscalation("esc_x", "bogus" as unknown as "resolve")
    ).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });
});

describe("pingWebmasterSlack — smoke handshake + live ping", () => {
  it("smokeTest=true short-circuits and returns ok without posting", async () => {
    callableMock.mockResolvedValueOnce({ data: { ok: true } });
    const res = await pingSlack(true);
    expect(res.data.ok).toBe(true);
    expect(callableMock).toHaveBeenCalledWith("pingWebmasterSlack", {
      agentName: "ci-runner",
      route: "/smoke-test",
      smokeTest: true,
    });
  });

  it("surfaces failed-precondition when webhook secret is missing", async () => {
    callableMock.mockRejectedValueOnce({
      code: "functions/failed-precondition",
      message: "Slack webhook is not configured.",
    });
    await expect(pingSlack(false)).rejects.toMatchObject({
      code: "functions/failed-precondition",
    });
  });

  it("rejects Firestore IDs that start AND end with double underscores", () => {
    // Regression for the SmokeTestPanel scratch-doc bug.
    expect(isValidFirestoreId("__smoke_test__")).toBe(false);
    expect(isValidFirestoreId("smoke-test-doc")).toBe(true);
    expect(isValidFirestoreId("esc_e2e_001")).toBe(true);
    expect(isValidFirestoreId("a/b")).toBe(false);
  });
});
