/**
 * Verifies the "Ping Webmaster" client wrapper writes the expected
 * shape to the `webmasterContactEvents` collection (the source for the
 * Internal agent logs panel on /settings).
 *
 * Pure unit test — `firebase/firestore` is mocked so no real backend
 * is required. Locks in:
 *
 *   1. addDoc is called with the `webmasterContactEvents` collection ref.
 *   2. The doc payload contains agentUid / agentName / channel / route +
 *      a serverTimestamp marker for createdAt.
 *   3. Overly-long names/routes are truncated to stay below Firestore
 *      field-length limits.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const addDocMock = vi.fn().mockResolvedValue({ id: "evt-1" });
const collectionMock = vi.fn((_db: unknown, name: string) => ({ __coll: name }));
const serverTimestampMock = vi.fn(() => "__SERVER_TS__");

vi.mock("firebase/firestore", () => ({
  addDoc: (...args: unknown[]) => addDocMock(...args),
  collection: (...args: unknown[]) =>
    (collectionMock as unknown as (...a: unknown[]) => unknown)(...args),
  serverTimestamp: () => serverTimestampMock(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/lib/firebase", () => ({ db: {} }));

import { logWebmasterContactEvent } from "@/lib/webmasterContactEvents";

describe("logWebmasterContactEvent → webmasterContactEvents", () => {
  beforeEach(() => {
    addDocMock.mockClear();
    collectionMock.mockClear();
    serverTimestampMock.mockClear();
  });

  it("posts to the webmasterContactEvents collection with the expected shape", async () => {
    await logWebmasterContactEvent({
      agentUid: "uid-1",
      agentName: "Alice Agent",
      channel: "text",
      route: "/conversations/abc",
    });

    expect(addDocMock).toHaveBeenCalledTimes(1);
    const [coll, payload] = addDocMock.mock.calls[0];
    expect((coll as { __coll: string }).__coll).toBe("webmasterContactEvents");
    expect(payload).toMatchObject({
      agentUid: "uid-1",
      agentName: "Alice Agent",
      channel: "text",
      route: "/conversations/abc",
      createdAt: "__SERVER_TS__",
    });
  });

  it("truncates overly-long agentName and route fields", async () => {
    const longName = "n".repeat(500);
    const longRoute = "/" + "x".repeat(500);
    await logWebmasterContactEvent({
      agentUid: "uid-2",
      agentName: longName,
      channel: "call",
      route: longRoute,
    });
    const [, payload] = addDocMock.mock.calls[0];
    expect((payload as { agentName: string }).agentName.length).toBeLessThanOrEqual(120);
    expect((payload as { route: string }).route.length).toBeLessThanOrEqual(240);
  });

  it("falls back to 'Unknown' + '/' when fields are blank", async () => {
    await logWebmasterContactEvent({
      agentUid: "uid-3",
      agentName: "",
      channel: "call",
      route: "",
    });
    const [, payload] = addDocMock.mock.calls[0];
    expect((payload as { agentName: string }).agentName).toBe("Unknown");
    expect((payload as { route: string }).route).toBe("/");
  });
});
