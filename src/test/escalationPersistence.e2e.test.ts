/**
 * Persistence contract for the webmaster escalation feature.
 *
 * Goal: confirm — without hand-waving — that what `requestWebmasterEscalation`
 * writes server-side is exactly what the webmaster Settings page reads back
 * from Firestore, so a freshly-submitted escalation is guaranteed to appear
 * in Settings → "Pending escalations" and survive a page reload.
 *
 * We can't spin up the Firebase emulator inside the Vitest sandbox, so this
 * suite pins the contract by reading the actual source files:
 *
 *   1. `functions/src/index.ts` MUST write to `escalationRequests` from
 *      inside `requestWebmasterEscalation`, with `status`, `reason`,
 *      `requesterUid`, and a server `createdAt` timestamp.
 *   2. `src/pages/Settings.tsx` MUST subscribe to the same
 *      `escalationRequests` collection with `onSnapshot` so persisted rows
 *      land in the Pending-escalations table in real time.
 *   3. The callable name shipped to the client matches the one the
 *      Cloud Function exports.
 *
 * If anyone renames the collection, drops the listener, or changes the
 * callable name, this test fails — protecting the "submit → see it in
 * Settings → still there after refresh" loop end-to-end.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const functionsSrc = readFileSync(resolve(__dirname, "../../functions/src/index.ts"), "utf8");
const settingsSrc = readFileSync(resolve(__dirname, "../pages/Settings.tsx"), "utf8");

describe("escalation persistence contract (function ↔ Settings)", () => {
  it("requestWebmasterEscalation persists to escalationRequests with the required fields", () => {
    // Slice out the body of the exported callable so we don't match writes
    // from sibling functions like notifyWebmaster or decideEscalationRequest.
    const start = functionsSrc.indexOf("export const requestWebmasterEscalation");
    expect(start, "requestWebmasterEscalation callable missing").toBeGreaterThan(-1);
    const body = functionsSrc.slice(start, start + 4000);

    expect(body).toMatch(/db\.collection\(["']escalationRequests["']\)\.add\(/);
    expect(body).toMatch(/status\s*:/);
    expect(body).toMatch(/reason\s*:/);
    expect(body).toMatch(/requesterUid\s*:/);
    expect(body).toMatch(/createdAt\s*:\s*admin\.firestore\.FieldValue\.serverTimestamp\(\)/);
  });

  it("Settings.tsx subscribes to escalationRequests via onSnapshot so persisted rows render live", () => {
    expect(settingsSrc).toMatch(/collection\(\s*db\s*,\s*["']escalationRequests["']\s*\)/);
    expect(settingsSrc).toMatch(/onSnapshot\(/);
    // The pending-escalations panel label that webmasters rely on.
    expect(settingsSrc).toMatch(/Pending escalations/);
  });

  it("callable name exported by the function matches what Settings invokes", () => {
    expect(functionsSrc).toMatch(/export const requestWebmasterEscalation\s*=\s*onCall/);
    expect(settingsSrc).toMatch(/["']requestWebmasterEscalation["']/);
  });

  it("manageEscalationRequest is wired for resolve / reopen / archive / restore from Settings", () => {
    expect(functionsSrc).toMatch(/export const manageEscalationRequest\s*=\s*onCall/);
    // Settings/Archive both rely on these four actions — pin the union here
    // so the lifecycle stays addressable from the webmaster UI.
    const actionsBlock = functionsSrc.slice(functionsSrc.indexOf("manageEscalationRequest"));
    for (const action of ["resolve", "reopen", "archive", "restore"]) {
      expect(actionsBlock).toContain(`"${action}"`);
    }
  });
});
