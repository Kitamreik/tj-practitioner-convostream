/**
 * Contract tests for the extended undo/session-guard/portal-kill-switch work.
 *
 *  1. Authorized-domain undo persists in localStorage with a 240s TTL and is
 *     restored across "navigation" (simulated by re-running the subscriber).
 *  2. `PendingDomainUndoBanner` reads the persisted queue, exposes a Undo
 *     control, and is mounted globally inside AppLayout so it survives every
 *     staff route change.
 *  3. Removing a domain in `AuthorizedDomainsPanel` enqueues an undo entry.
 *  4. Route guards refuse to render profile-scoped pages in a "fresh browser
 *     session" — modeled by the ProtectedRoute + CustomerRoute source
 *     asserting the loading→!user / !profile redirect ladder and by
 *     rendering the router with no signed-in session.
 *  5. When `customerPortalEnabled` flips to false, every /portal/* route
 *     (login, signup, chat, thread) short-circuits to the PortalClosed
 *     screen — including for a signed-in customer.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { render, screen, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Navigate } from "react-router-dom";
import React from "react";
import {
  UNDO_TTL_MS,
  queuePendingDomainUndo,
  listPendingDomainUndos,
  clearAllPendingDomainUndos,
  subscribePendingDomainUndos,
} from "@/lib/authorizedDomainUndo";

const read = (p: string) => readFileSync(resolve(p), "utf8");

// -------------------------------------------------------------------------
// 1. Persistent undo window
// -------------------------------------------------------------------------
describe("Authorized-domain undo (persistent 240s window)", () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllPendingDomainUndos();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("uses a 240-second TTL", () => {
    expect(UNDO_TTL_MS).toBe(240_000);
  });

  it("persists the removal to localStorage with the correct expiry", () => {
    const now = 1_000_000;
    const entry = queuePendingDomainUndo("preview.example.com", now);
    expect(entry.expiresAt - entry.removedAt).toBe(UNDO_TTL_MS);

    const raw = localStorage.getItem("ConvoHub.authorizedDomain.undo.v1");
    expect(raw).toContain("preview.example.com");
    expect(JSON.parse(raw!)[0].expiresAt).toBe(now + UNDO_TTL_MS);
  });

  it("survives a simulated navigation — a fresh subscriber sees the entry", () => {
    queuePendingDomainUndo("preview.example.com");
    // Simulate the banner unmounting (navigation) and remounting on the next page.
    const seen: string[][] = [];
    const unsub = subscribePendingDomainUndos((entries) =>
      seen.push(entries.map((e) => e.domain))
    );
    unsub();
    const seenAgain: string[][] = [];
    const unsub2 = subscribePendingDomainUndos((entries) =>
      seenAgain.push(entries.map((e) => e.domain))
    );
    unsub2();

    expect(seen[0]).toContain("preview.example.com");
    expect(seenAgain[0]).toContain("preview.example.com");
  });

  it("prunes entries once the 240s TTL elapses", () => {
    const t0 = 5_000_000;
    queuePendingDomainUndo("stale.example.com", t0);
    // Before expiry: still there.
    expect(listPendingDomainUndos(t0 + UNDO_TTL_MS - 1).map((e) => e.domain))
      .toContain("stale.example.com");
    // After expiry: pruned from both the returned list and storage.
    const after = listPendingDomainUndos(t0 + UNDO_TTL_MS + 1);
    expect(after.find((e) => e.domain === "stale.example.com")).toBeUndefined();
    expect(localStorage.getItem("ConvoHub.authorizedDomain.undo.v1")).not.toContain("stale.example.com");
  });
});

// -------------------------------------------------------------------------
// 2. Banner + wiring
// -------------------------------------------------------------------------
describe("PendingDomainUndoBanner wiring", () => {
  it("is mounted globally inside AppLayout so it survives every staff route", () => {
    const layout = read("src/components/AppLayout.tsx");
    expect(layout).toContain("PendingDomainUndoBanner");
    expect(layout).toMatch(/<PendingDomainUndoBanner\s*\/>/);
  });

  it("renders only for webmasters and exposes an Undo control", () => {
    const src = read("src/components/PendingDomainUndoBanner.tsx");
    expect(src).toMatch(/profile\.role !== "webmaster"/);
    expect(src).toContain("addAuthorizedDomain");
    expect(src).toContain("Undo");
    expect(src).toContain("data-testid=\"domain-undo-banner\"");
  });

  it("AuthorizedDomainsPanel enqueues an undo entry on successful removal", () => {
    const panel = read("src/components/AuthorizedDomainsPanel.tsx");
    expect(panel).toContain("queuePendingDomainUndo");
    // Enqueue happens AFTER the callable resolves, before the toast is fired.
    const idxCall = panel.indexOf("removeAuthorizedDomain");
    const idxQueue = panel.indexOf("queuePendingDomainUndo(domain)");
    const idxToast = panel.indexOf("title: \"Domain removed\"");
    expect(idxCall).toBeGreaterThan(0);
    expect(idxQueue).toBeGreaterThan(idxCall);
    expect(idxToast).toBeGreaterThan(idxQueue);
  });
});

// -------------------------------------------------------------------------
// 3. Fresh browser session — direct URL entry to profile-scoped pages
// -------------------------------------------------------------------------
// We reproduce ProtectedRoute / CustomerRoute contracts in-test. In a
// signed-out fresh session both must redirect away from profile-scoped
// URLs regardless of the path typed into the address bar.
describe("Route guards on a fresh browser session (no auth)", () => {
  afterEach(() => cleanup());

  // Minimal mirror of the guards under test. Any drift here would be caught
  // by the source-string assertions below, which anchor to the real file.
  const ProtectedRoute: React.FC<{ user: any; profile: any; loading: boolean; children: React.ReactNode }> =
    ({ user, profile, loading, children }) => {
      if (loading) return <div>Loading...</div>;
      if (!user) return <Navigate to="/login" replace />;
      if (!profile) return <Navigate to="/login" replace />;
      return <>{children}</>;
    };
  const CustomerRoute: React.FC<{ user: any; profile: any; loading: boolean; portalEnabled: boolean; children: React.ReactNode }> =
    ({ user, profile, loading, portalEnabled, children }) => {
      if (loading) return <div>Loading...</div>;
      if (!portalEnabled) return <div>Customer portal is closed</div>;
      if (!user) return <Navigate to="/portal/login" replace />;
      if (!profile) return <Navigate to="/portal/login" replace />;
      return <>{children}</>;
    };

  const staffPaths = ["/settings", "/conversations", "/gmail", "/agent-logs", "/audit"];
  const customerPaths = ["/portal/chat", "/portal/conversations/abc"];

  for (const path of staffPaths) {
    it(`redirects unauthenticated typing of ${path} to /login`, () => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/login" element={<div>LOGIN_PAGE</div>} />
            <Route
              path={path}
              element={
                <ProtectedRoute user={null} profile={null} loading={false}>
                  <div>PROFILE_PAGE</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      );
      expect(screen.getByText("LOGIN_PAGE")).toBeInTheDocument();
      expect(screen.queryByText("PROFILE_PAGE")).not.toBeInTheDocument();
    });
  }

  for (const path of customerPaths) {
    it(`redirects unauthenticated typing of ${path} to /portal/login`, () => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/portal/login" element={<div>PORTAL_LOGIN</div>} />
            <Route
              path={path}
              element={
                <CustomerRoute user={null} profile={null} loading={false} portalEnabled={true}>
                  <div>PORTAL_PAGE</div>
                </CustomerRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      );
      expect(screen.getByText("PORTAL_LOGIN")).toBeInTheDocument();
      expect(screen.queryByText("PORTAL_PAGE")).not.toBeInTheDocument();
    });
  }

  it("redirects signed-in-but-no-profile sessions off staff pages too", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/login" element={<div>LOGIN_PAGE</div>} />
          <Route
            path="/settings"
            element={
              <ProtectedRoute user={{ uid: "u1" }} profile={null} loading={false}>
                <div>SETTINGS_PAGE</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText("LOGIN_PAGE")).toBeInTheDocument();
  });

  it("anchors the mirrored guards to the real App.tsx source", () => {
    const app = read("src/App.tsx");
    expect(app).toMatch(/if \(!user\) return <Navigate to="\/login"/);
    expect(app).toMatch(/if \(!profile\) return <Navigate to="\/login"/);
    expect(app).toMatch(/if \(!user\) return <Navigate to="\/portal\/login"/);
    expect(app).toMatch(/if \(!profile\) return <Navigate to="\/portal\/login"/);
  });
});

// -------------------------------------------------------------------------
// 4. Portal kill switch — every /portal/* route blocks immediately
// -------------------------------------------------------------------------
describe("Customer portal kill switch — signed-in customer is blocked immediately", () => {
  afterEach(() => cleanup());

  const PortalClosed = () => <div>PORTAL_CLOSED</div>;
  const PortalContent = () => <div>PORTAL_CONTENT</div>;

  // Mirrors the App.tsx CustomerRoute + PortalPublicRoute contract.
  const CustomerRoute: React.FC<{ portalEnabled: boolean; children: React.ReactNode }> =
    ({ portalEnabled, children }) => {
      if (!portalEnabled) return <PortalClosed />;
      return <>{children}</>;
    };
  const PortalPublicRoute: React.FC<{ portalEnabled: boolean; children: React.ReactNode }> =
    ({ portalEnabled, children }) => {
      if (!portalEnabled) return <PortalClosed />;
      return <>{children}</>;
    };

  const routes = [
    { path: "/portal/login", Guard: PortalPublicRoute },
    { path: "/portal/signup", Guard: PortalPublicRoute },
    { path: "/portal/chat", Guard: CustomerRoute },
    { path: "/portal/conversations/abc", Guard: CustomerRoute },
  ];

  for (const { path, Guard } of routes) {
    it(`blocks ${path} with the PortalClosed screen when the switch is off`, () => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path={path}
              element={
                <Guard portalEnabled={false}>
                  <PortalContent />
                </Guard>
              }
            />
          </Routes>
        </MemoryRouter>
      );
      expect(screen.getByText("PORTAL_CLOSED")).toBeInTheDocument();
      expect(screen.queryByText("PORTAL_CONTENT")).not.toBeInTheDocument();
    });
  }

  it("flipping the switch back to enabled re-renders the portal content", () => {
    const Case: React.FC<{ enabled: boolean }> = ({ enabled }) => (
      <MemoryRouter initialEntries={["/portal/chat"]}>
        <Routes>
          <Route
            path="/portal/chat"
            element={
              <CustomerRoute portalEnabled={enabled}>
                <PortalContent />
              </CustomerRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    const { rerender } = render(<Case enabled={false} />);
    expect(screen.getByText("PORTAL_CLOSED")).toBeInTheDocument();
    rerender(<Case enabled={true} />);
    expect(screen.getByText("PORTAL_CONTENT")).toBeInTheDocument();
  });

  it("anchors the mirrored kill-switch guards to the real App.tsx source", () => {
    const app = read("src/App.tsx");
    // Both guards consult usePortalEnabled and short-circuit on !enabled.
    expect(app).toContain("PortalPublicRoute");
    expect(app).toMatch(/if \(!enabled\) return <PortalClosed/);
    expect(app).toMatch(/if \(!portalEnabled\) return <PortalClosed/);
    // Every /portal/* route is wrapped in one of the two guards.
    expect(app).toMatch(/path="\/portal\/login" element=\{<PortalPublicRoute>/);
    expect(app).toMatch(/path="\/portal\/signup" element=\{<PortalPublicRoute>/);
    expect(app).toMatch(/path="\/portal\/chat"[\s\S]{0,120}<CustomerRoute>/);
    expect(app).toMatch(/path="\/portal\/conversations\/:id"[\s\S]{0,120}<CustomerRoute>/);
  });
});

// -------------------------------------------------------------------------
// 5. TTL boundary — Undo disappears exactly at the 240s mark
// -------------------------------------------------------------------------
describe("Undo TTL boundary — Undo option ends precisely at 240s", () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllPendingDomainUndos();
  });
  afterEach(() => localStorage.clear());

  it("keeps the entry visible up to and including the millisecond before expiry", () => {
    const t0 = 10_000_000;
    const entry = queuePendingDomainUndo("edge.example.com", t0);
    const boundary = entry.expiresAt; // t0 + 240_000

    // 1 ms before expiry — banner would still show Undo.
    const before = listPendingDomainUndos(boundary - 1);
    expect(before.find((e) => e.domain === "edge.example.com")).toBeDefined();
  });

  it("removes the entry at exactly the 240s boundary and never resurrects it", () => {
    const t0 = 10_000_000;
    const entry = queuePendingDomainUndo("edge.example.com", t0);
    const boundary = entry.expiresAt;

    // At t = expiresAt the filter `expiresAt > now` becomes false — the
    // banner's Undo button must disappear immediately.
    const at = listPendingDomainUndos(boundary);
    expect(at.find((e) => e.domain === "edge.example.com")).toBeUndefined();

    // 1ms and 1s after: still gone, and pruned from storage.
    expect(
      listPendingDomainUndos(boundary + 1).find((e) => e.domain === "edge.example.com")
    ).toBeUndefined();
    expect(
      listPendingDomainUndos(boundary + 1_000).find((e) => e.domain === "edge.example.com")
    ).toBeUndefined();
    expect(localStorage.getItem("ConvoHub.authorizedDomain.undo.v1"))
      .not.toContain("edge.example.com");
  });

  it("mirrors the banner's own live filter — `expiresAt > now`", () => {
    // Anchor the boundary logic to the banner source so a future refactor
    // that flips the comparison to `>=` is caught immediately.
    const src = read("src/components/PendingDomainUndoBanner.tsx");
    expect(src).toMatch(/entries\.filter\(\(e\) => e\.expiresAt > now\)/);
  });
});

// -------------------------------------------------------------------------
// 6. Countdown restoration after a full page refresh
// -------------------------------------------------------------------------
describe("Undo countdown restoration after a full page refresh", () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllPendingDomainUndos();
  });
  afterEach(() => localStorage.clear());

  it("recomputes the remaining seconds from the persisted expiresAt, not from removedAt", () => {
    const removedAt = 20_000_000;
    queuePendingDomainUndo("refresh.example.com", removedAt);

    // Simulate a full page refresh 100s later: nothing in memory, only
    // the localStorage row survives. A fresh subscriber has to read the
    // same expiresAt and compute the correct remaining window.
    const reloadedAt = removedAt + 100_000;
    const entries = listPendingDomainUndos(reloadedAt);
    const entry = entries.find((e) => e.domain === "refresh.example.com");
    expect(entry).toBeDefined();
    expect(entry!.expiresAt).toBe(removedAt + UNDO_TTL_MS);

    // Remaining seconds displayed by the banner:
    //   Math.max(0, Math.ceil((expiresAt - now) / 1000))
    const remaining = Math.max(0, Math.ceil((entry!.expiresAt - reloadedAt) / 1000));
    expect(remaining).toBe(140); // 240 - 100
  });

  it("expires automatically at the correct TTL even if the tab was never focused", () => {
    const removedAt = 30_000_000;
    queuePendingDomainUndo("stale-refresh.example.com", removedAt);

    // "Refresh" happens 241s later — past the TTL.
    const reloadedAt = removedAt + UNDO_TTL_MS + 1_000;
    const entries = listPendingDomainUndos(reloadedAt);
    expect(entries.find((e) => e.domain === "stale-refresh.example.com")).toBeUndefined();
    // Reading also prunes the row from storage on the next tab lifetime.
    expect(localStorage.getItem("ConvoHub.authorizedDomain.undo.v1"))
      .not.toContain("stale-refresh.example.com");
  });

  it("banner reads the persisted expiresAt directly and renders a live countdown", () => {
    const src = read("src/components/PendingDomainUndoBanner.tsx");
    // The countdown is derived from expiresAt, not stored as a mutable
    // "secondsLeft" number — that's what makes it correct across refresh.
    expect(src).toMatch(/Math\.ceil\(\(entry\.expiresAt - now\) \/ 1000\)/);
    // A 1s ticker keeps the visible number in sync with wall-clock time.
    expect(src).toContain('setInterval(() => setNow(Date.now()), 1000)');
  });
});

// -------------------------------------------------------------------------
// 7. Real-time customer notification on portal-off + cross-tab redirect
// -------------------------------------------------------------------------
describe("Real-time notification when the customer portal is toggled off", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("customer-only: fires a toast on the true→false transition", async () => {
    const { toast } = await import("@/hooks/use-toast");
    const spy = vi.spyOn(toast as any, "call" as any);
    // vi.spyOn on the function itself is awkward — spy on the module export.
    const useToastMod = await import("@/hooks/use-toast");
    const toastSpy = vi.spyOn(useToastMod, "toast");
    const { useCustomerPortalKillNotification } = await import(
      "@/hooks/useCustomerPortalKillNotification"
    );

    const Harness: React.FC<{ enabled: boolean; role: string }> = ({ enabled, role }) => {
      useCustomerPortalKillNotification(enabled, role);
      return <div>ok</div>;
    };

    const { rerender } = render(<Harness enabled={true} role="customer" />);
    expect(toastSpy).not.toHaveBeenCalled();

    // Flip OFF — should fire exactly one toast.
    rerender(<Harness enabled={false} role="customer" />);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0][0]).toMatchObject({
      title: expect.stringMatching(/portal/i),
      variant: "destructive",
    });

    // Flip ON again — no additional toast on recovery.
    rerender(<Harness enabled={true} role="customer" />);
    expect(toastSpy).toHaveBeenCalledTimes(1);

    // Unused reference kept to satisfy linter for the first spy attempt.
    void spy;
  });

  it("non-customer roles never see the kill-switch toast", async () => {
    const useToastMod = await import("@/hooks/use-toast");
    const toastSpy = vi.spyOn(useToastMod, "toast");
    const { useCustomerPortalKillNotification } = await import(
      "@/hooks/useCustomerPortalKillNotification"
    );

    const Harness: React.FC<{ enabled: boolean; role: string }> = ({ enabled, role }) => {
      useCustomerPortalKillNotification(enabled, role);
      return <div>ok</div>;
    };
    const { rerender } = render(<Harness enabled={true} role="webmaster" />);
    rerender(<Harness enabled={false} role="webmaster" />);
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("CustomerRoute mounts the notifier hook alongside the redirect guard", () => {
    const app = read("src/App.tsx");
    expect(app).toContain("useCustomerPortalKillNotification");
    // The hook is called with the live enabled flag AND the current
    // profile role so it can no-op for non-customers.
    expect(app).toMatch(/useCustomerPortalKillNotification\(portalEnabled, profile\?\.role\)/);
  });

  it("portalStatus subscribes to cross-tab `storage` events so every open tab flips at once", () => {
    const lib = read("src/lib/portalStatus.ts");
    // Firestore onSnapshot handles the tab that initiated the change.
    expect(lib).toContain('addEventListener("storage"');
    expect(lib).toContain("getCachedPortalEnabled()");
    // Cleanup removes the storage listener when the subscriber unmounts.
    expect(lib).toContain('removeEventListener("storage"');
  });

  it("cross-tab: a storage event carrying the disabled cache flips subscribers to false", () => {
    // Seed the cache to "enabled=true", then simulate another tab writing
    // "0" and dispatching a StorageEvent for the portal-enabled key. The
    // subscriber must invoke its callback with `false` — this is the exact
    // path that makes a second open tab redirect immediately.
    localStorage.setItem("ConvoHub.portalEnabled.v1", "1");
    const seen: boolean[] = [];

    // Import lazily so the module-level LS_KEY constant is already defined.
    return import("@/lib/portalStatus").then(({ subscribePortalEnabled }) => {
      // We can't actually reach Firestore in the test env, but the storage
      // listener is registered synchronously before onSnapshot resolves.
      const unsub = subscribePortalEnabled((v) => seen.push(v));

      // Another tab: write the disabled flag and fire the storage event
      // that the browser would normally deliver.
      localStorage.setItem("ConvoHub.portalEnabled.v1", "0");
      act(() => {
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "ConvoHub.portalEnabled.v1",
            newValue: "0",
            oldValue: "1",
            storageArea: localStorage,
          })
        );
      });

      // The storage-triggered callback reads the cached value and pushes
      // `false` into our recorder.
      expect(seen).toContain(false);
      unsub();
    });
  });
});
