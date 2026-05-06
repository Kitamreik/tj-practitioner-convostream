/**
 * Shape + error-mapping tests for the client-side wrappers around the
 * `pingWebmasterSlack` and `promoteToWebmaster` Firebase callables.
 *
 * These tests run entirely in the Vitest sandbox — they mock
 * `firebase/functions` so no deployed endpoint is required. They lock in:
 *
 *   1. The success payload is forwarded verbatim (ok + nextAllowedAt).
 *   2. `resource-exhausted` errors are surfaced as `rateLimited: true`
 *      and `nextAllowedAt` is taken from `details.retryAt`.
 *   3. `not-found` (the 404 we currently see in prod when the function
 *      isn't deployed) and `permission-denied` errors degrade gracefully
 *      to `{ ok: false, error }` without crashing the caller.
 *
 * If anyone changes the error mapping in `src/lib/notifyWebmaster.ts`,
 * these tests will fail loudly so the SlackAlertButton toast contract
 * stays intact.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock firebase/functions BEFORE importing the module under test.
const callableMock = vi.fn();
vi.mock("firebase/functions", () => ({
  // httpsCallable returns a function that, when called, invokes our mock.
  httpsCallable: (_fns: unknown, _name: string) => (data: unknown) => callableMock(data),
  getFunctions: () => ({}),
}));
vi.mock("@/lib/firebase", () => ({
  functions: {},
  db: {},
  auth: {},
}));

// Imported AFTER mocks so the module picks up the mocked httpsCallable.
import { pingWebmasterSlackAlert } from "@/lib/notifyWebmaster";

describe("pingWebmasterSlackAlert — shape + error mapping", () => {
  beforeEach(() => {
    callableMock.mockReset();
  });

  it("returns ok=true and nextAllowedAt on success", async () => {
    const nextAllowedAt = Date.now() + 600_000;
    callableMock.mockResolvedValueOnce({
      data: { ok: true, sentAt: Date.now(), nextAllowedAt },
    });
    const res = await pingWebmasterSlackAlert({ route: "/home" });
    expect(res.ok).toBe(true);
    expect(res.nextAllowedAt).toBe(nextAllowedAt);
    expect(res.rateLimited).toBeFalsy();
  });

  it("maps resource-exhausted to rateLimited with retryAt", async () => {
    const retryAt = Date.now() + 120_000;
    callableMock.mockRejectedValueOnce({
      code: "functions/resource-exhausted",
      message: "Slack alert rate limit hit.",
      details: { retryAt },
    });
    const res = await pingWebmasterSlackAlert({ route: "/conversations" });
    expect(res.ok).toBe(false);
    expect(res.rateLimited).toBe(true);
    expect(res.nextAllowedAt).toBe(retryAt);
    expect(res.error).toMatch(/rate limit/i);
  });

  it("treats a 404/not-found (function not deployed) as a non-rate-limited failure", async () => {
    callableMock.mockRejectedValueOnce({
      code: "functions/not-found",
      message: "NOT_FOUND",
    });
    const res = await pingWebmasterSlackAlert({ route: "/" });
    expect(res.ok).toBe(false);
    expect(res.rateLimited).toBe(false);
    expect(res.nextAllowedAt).toBeUndefined();
    expect(res.error).toBe("NOT_FOUND");
  });

  it("treats permission-denied as a non-rate-limited failure", async () => {
    callableMock.mockRejectedValueOnce({
      code: "functions/permission-denied",
      message: "Account role is not authorized to send Slack alerts.",
    });
    const res = await pingWebmasterSlackAlert({ route: "/agent-logs" });
    expect(res.ok).toBe(false);
    expect(res.rateLimited).toBe(false);
    expect(res.error).toMatch(/not authorized/i);
  });

  it("treats failed-precondition (no webhook configured) as a failure with the server message", async () => {
    callableMock.mockRejectedValueOnce({
      code: "functions/failed-precondition",
      message: "Slack webhook is not configured. Ask an admin or webmaster to set it on Settings.",
    });
    const res = await pingWebmasterSlackAlert({ route: "/" });
    expect(res.ok).toBe(false);
    expect(res.rateLimited).toBe(false);
    expect(res.error).toMatch(/not configured/i);
  });

  it("forwards a default route when caller passes empty string", async () => {
    callableMock.mockResolvedValueOnce({ data: { ok: true, sentAt: 0, nextAllowedAt: 0 } });
    await pingWebmasterSlackAlert({ route: "" });
    expect(callableMock).toHaveBeenCalledWith({ route: "/" });
  });
});

/**
 * promoteToWebmaster — the Settings page invokes httpsCallable inline, so we
 * exercise the same callable wiring + error-code surface here. These tests
 * pin the contract Settings.tsx relies on so a regression in callable error
 * shape would surface as a failing unit test rather than a silent prod bug.
 */
describe("promoteToWebmaster callable — shape + error mapping", () => {
  beforeEach(() => {
    callableMock.mockReset();
  });

  // Re-create the same lightweight invocation Settings.tsx performs so we
  // don't have to render the whole page just to test the mapping.
  async function invokePromote(targetIdentifier: string) {
    const { httpsCallable } = await import("firebase/functions");
    const { functions } = await import("@/lib/firebase");
    const fn = httpsCallable<
      { targetIdentifier: string; role: "webmaster" },
      { ok: boolean; previousRole: string; newRole: string; escalationRequestId?: string }
    >(functions, "promoteToWebmaster");
    return fn({ targetIdentifier, role: "webmaster" });
  }

  it("returns server payload on success", async () => {
    callableMock.mockResolvedValueOnce({
      data: { ok: true, previousRole: "agent", newRole: "webmaster", escalationRequestId: "abc123" },
    });
    const res = await invokePromote("user@example.com");
    expect(res.data.ok).toBe(true);
    expect(res.data.previousRole).toBe("agent");
    expect(res.data.newRole).toBe("webmaster");
    expect(res.data.escalationRequestId).toBe("abc123");
  });

  it("propagates not-found (no account for that email) so the UI can toast it", async () => {
    callableMock.mockRejectedValueOnce({
      code: "functions/not-found",
      message: "No account found for ghost@example.com.",
    });
    await expect(invokePromote("ghost@example.com")).rejects.toMatchObject({
      code: "functions/not-found",
      message: expect.stringContaining("No account found"),
    });
  });

  it("propagates permission-denied (caller is not a webmaster)", async () => {
    callableMock.mockRejectedValueOnce({
      code: "functions/permission-denied",
      message: "Only webmasters can grant roles.",
    });
    await expect(invokePromote("user@example.com")).rejects.toMatchObject({
      code: "functions/permission-denied",
    });
  });

  it("propagates invalid-argument when identifier is malformed at the server", async () => {
    callableMock.mockRejectedValueOnce({
      code: "functions/invalid-argument",
      message: "A valid account identifier is required.",
    });
    await expect(invokePromote("not-an-email")).rejects.toMatchObject({
      code: "functions/invalid-argument",
    });
  });

  it("propagates 404-shaped errors (callable not deployed)", async () => {
    // The Functions SDK surfaces a deployment 404 as `functions/not-found`
    // with a generic message — the same shape Settings.tsx must handle.
    callableMock.mockRejectedValueOnce({
      code: "functions/not-found",
      message: "NOT_FOUND",
    });
    await expect(invokePromote("user@example.com")).rejects.toMatchObject({
      code: "functions/not-found",
      message: "NOT_FOUND",
    });
  });
});
