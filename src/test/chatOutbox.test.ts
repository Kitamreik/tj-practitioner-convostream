/**
 * Unit tests for the chat outbox.
 *
 * Verifies:
 *   - enqueue persists to localStorage and survives a "reload" (re-read).
 *   - flushOutbox successfully drains entries when Firestore writes resolve.
 *   - flushOutbox preserves entries when Firestore writes reject (offline).
 *   - flushOutbox no-ops when navigator.onLine === false.
 *   - clearOutbox wipes the queue.
 *
 * Firestore is mocked at the module level so no real network calls happen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addDocMock = vi.fn();
const updateDocMock = vi.fn();

vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>("firebase/firestore");
  return {
    ...actual,
    addDoc: (...args: unknown[]) => addDocMock(...args),
    updateDoc: (...args: unknown[]) => updateDocMock(...args),
    collection: vi.fn(() => ({})),
    doc: vi.fn(() => ({})),
    serverTimestamp: vi.fn(() => ({ __sentinel: "serverTimestamp" })),
  };
});

vi.mock("@/lib/firebase", () => ({ db: {} }));

// Now safe to import the module under test.
import {
  clearOutbox,
  dequeueOutbox,
  enqueueOutbox,
  flushOutbox,
  getOutboxSize,
  listOutbox,
} from "@/lib/chatOutbox";

const UID = "test-uid-1";

function makeEntry(overrides: Partial<Parameters<typeof enqueueOutbox>[0]> = {}) {
  return {
    clientId: `local-${Math.random().toString(36).slice(2, 8)}`,
    threadId: "thread-1",
    senderUid: UID,
    senderName: "Tester",
    senderEmail: "tester@example.com",
    body: "hello world",
    ...overrides,
  };
}

describe("chatOutbox", () => {
  beforeEach(() => {
    localStorage.clear();
    addDocMock.mockReset();
    updateDocMock.mockReset();
    // Default: pretend we're online.
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  afterEach(() => {
    clearOutbox(UID);
  });

  it("enqueues and persists to localStorage", () => {
    enqueueOutbox(makeEntry({ clientId: "c1" }));
    expect(getOutboxSize(UID)).toBe(1);
    // Simulate "reload": fresh listOutbox call should still see the entry.
    expect(listOutbox(UID)).toHaveLength(1);
    expect(listOutbox(UID)[0].clientId).toBe("c1");
  });

  it("dedupes by clientId on re-enqueue", () => {
    enqueueOutbox(makeEntry({ clientId: "c1", body: "first" }));
    enqueueOutbox(makeEntry({ clientId: "c1", body: "second" }));
    const q = listOutbox(UID);
    expect(q).toHaveLength(1);
    expect(q[0].body).toBe("second");
  });

  it("flushes successfully and drains the queue", async () => {
    addDocMock.mockResolvedValue({ id: "server-1" });
    updateDocMock.mockResolvedValue(undefined);
    enqueueOutbox(makeEntry({ clientId: "c1" }));
    enqueueOutbox(makeEntry({ clientId: "c2", body: "second" }));
    const flushed = await flushOutbox(UID);
    expect(flushed).toBe(2);
    expect(getOutboxSize(UID)).toBe(0);
    expect(addDocMock).toHaveBeenCalledTimes(2);
  });

  it("preserves entries and bumps attempts when Firestore rejects", async () => {
    addDocMock.mockRejectedValue(new Error("network down"));
    enqueueOutbox(makeEntry({ clientId: "c1" }));
    const flushed = await flushOutbox(UID);
    expect(flushed).toBe(0);
    const q = listOutbox(UID);
    expect(q).toHaveLength(1);
    expect(q[0].attempts).toBe(1);
  });

  it("processes entries oldest-first and stops on first failure", async () => {
    enqueueOutbox({ ...makeEntry({ clientId: "old" }), enqueuedAtMs: 1000 });
    enqueueOutbox({ ...makeEntry({ clientId: "new" }), enqueuedAtMs: 2000 });
    addDocMock
      .mockResolvedValueOnce({ id: "server-1" }) // oldest succeeds
      .mockRejectedValueOnce(new Error("transient")); // newer fails
    updateDocMock.mockResolvedValue(undefined);
    const flushed = await flushOutbox(UID);
    expect(flushed).toBe(1);
    const remaining = listOutbox(UID);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].clientId).toBe("new");
  });

  it("no-ops when navigator.onLine is false", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    enqueueOutbox(makeEntry({ clientId: "c1" }));
    const flushed = await flushOutbox(UID);
    expect(flushed).toBe(0);
    expect(addDocMock).not.toHaveBeenCalled();
    expect(getOutboxSize(UID)).toBe(1);
  });

  it("clearOutbox wipes the queue", () => {
    enqueueOutbox(makeEntry({ clientId: "c1" }));
    enqueueOutbox(makeEntry({ clientId: "c2" }));
    expect(getOutboxSize(UID)).toBe(2);
    clearOutbox(UID);
    expect(getOutboxSize(UID)).toBe(0);
  });

  it("dequeueOutbox removes a specific entry", () => {
    enqueueOutbox(makeEntry({ clientId: "c1" }));
    enqueueOutbox(makeEntry({ clientId: "c2" }));
    dequeueOutbox(UID, "c1");
    const q = listOutbox(UID);
    expect(q).toHaveLength(1);
    expect(q[0].clientId).toBe("c2");
  });

  it("concurrent flushOutbox calls are coalesced", async () => {
    addDocMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ id: "s" }), 20))
    );
    updateDocMock.mockResolvedValue(undefined);
    enqueueOutbox(makeEntry({ clientId: "c1" }));
    const [a, b] = await Promise.all([flushOutbox(UID), flushOutbox(UID)]);
    // Both promises resolve to the same flush result — addDoc only called once.
    expect(addDocMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
});
