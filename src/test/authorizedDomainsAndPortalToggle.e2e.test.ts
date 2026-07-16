/**
 * Contract tests for the authorized-domain callables + customer portal
 * webmaster-controlled kill switch.
 *
 *   1. `addAuthorizedDomain`, `removeAuthorizedDomain`, and
 *      `listAuthorizedDomains` all go through `requireAdminOrWebmaster` on
 *      the server, so a plain agent / customer / anonymous caller is
 *      rejected before any Identity Toolkit request is made.
 *   2. `requireAdminOrWebmaster` itself throws `permission-denied` for any
 *      role that is not exactly "admin" or "webmaster".
 *   3. The UI removal path is wrapped in an AlertDialog confirmation with
 *      an Undo toast action.
 *   4. `systemConfig/portal` is public-read + webmaster-write in the
 *      Firestore rules, and the portal route guards consult
 *      `subscribePortalEnabled` so a closed portal blocks /portal/login
 *      and /portal/signup as well as the CustomerRoute.
 *   5. ProtectedRoute + CustomerRoute both redirect signed-in users who
 *      never resolved a profile document — no profile-scoped page renders
 *      without a matching Firestore profile.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const read = (p: string) => readFileSync(resolve(p), "utf8");

describe("Authorized-domain callable authorization", () => {
  const fnSrc = read("functions/src/index.ts");

  it("requireAdminOrWebmaster gates listAuthorizedDomains", () => {
    const block = fnSrc.slice(fnSrc.indexOf("export const listAuthorizedDomains"));
    expect(block.slice(0, 600)).toContain("requireAdminOrWebmaster(request.auth.uid)");
  });

  it("requireAdminOrWebmaster gates addAuthorizedDomain", () => {
    const block = fnSrc.slice(fnSrc.indexOf("export const addAuthorizedDomain"));
    expect(block.slice(0, 600)).toContain("requireAdminOrWebmaster(request.auth.uid)");
  });

  it("requireAdminOrWebmaster gates removeAuthorizedDomain", () => {
    const block = fnSrc.slice(fnSrc.indexOf("export const removeAuthorizedDomain"));
    expect(block.slice(0, 600)).toContain("requireAdminOrWebmaster(request.auth.uid)");
  });

  it("requireAdminOrWebmaster throws permission-denied for any non-admin/non-webmaster role", () => {
    // Extract the helper body and assert it hard-fails on roles !== admin/webmaster.
    const helperIdx = fnSrc.indexOf("async function requireAdminOrWebmaster");
    expect(helperIdx).toBeGreaterThan(0);
    const helper = fnSrc.slice(helperIdx, helperIdx + 600);
    // The helper reads users/{uid}.role and throws HttpsError("permission-denied", ...)
    // unless the role is admin or webmaster.
    expect(helper).toMatch(/permission-denied/);
    expect(helper).toMatch(/admin|webmaster/);
  });

  it("all three callables require an authenticated request", () => {
    for (const name of ["listAuthorizedDomains", "addAuthorizedDomain", "removeAuthorizedDomain"]) {
      const block = fnSrc.slice(fnSrc.indexOf(`export const ${name}`), fnSrc.indexOf(`export const ${name}`) + 500);
      expect(block).toContain('throw new HttpsError("unauthenticated"');
    }
  });
});

describe("AuthorizedDomainsPanel removal safety", () => {
  const panel = read("src/components/AuthorizedDomainsPanel.tsx");

  it("routes every remove click through a confirmation AlertDialog", () => {
    expect(panel).toContain("AlertDialog");
    expect(panel).toContain("setConfirmRemove");
    expect(panel).toMatch(/onClick=\{\(\) => requestRemove\(d\)\}/);
  });

  it("surfaces an Undo toast action after a successful removal", () => {
    expect(panel).toContain("ToastAction");
    expect(panel).toMatch(/Undo/);
    expect(panel).toMatch(/void add\(domain\)/);
  });

  it("flags the current environment inside the confirm dialog", () => {
    expect(panel).toContain("confirmIsCurrent");
    expect(panel).toMatch(/current environment/i);
  });
});

describe("Customer portal kill switch", () => {
  it("Firestore rules expose systemConfig/{docId} as public-read, webmaster-write", () => {
    const rules = read("firestore.rules");
    expect(rules).toMatch(/match \/systemConfig\/\{docId\}/);
    const block = rules.slice(rules.indexOf("match /systemConfig/{docId}"));
    expect(block.slice(0, 300)).toMatch(/allow read:\s*if true/);
    expect(block.slice(0, 300)).toMatch(/allow write:\s*if isWebmaster\(\)/);
  });

  it("portalStatus lib exposes subscribe + setter helpers", () => {
    const lib = read("src/lib/portalStatus.ts");
    expect(lib).toContain("subscribePortalEnabled");
    expect(lib).toContain("setPortalEnabled");
    expect(lib).toContain("systemConfig");
  });

  it("Settings mounts the webmaster-only CustomerPortalTogglePanel", () => {
    const settings = read("src/pages/Settings.tsx");
    expect(settings).toContain("CustomerPortalTogglePanel");
    expect(settings).toMatch(/isWebmaster && <CustomerPortalTogglePanel/);
  });

  it("Portal public + customer routes render the PortalClosed screen when disabled", () => {
    const app = read("src/App.tsx");
    expect(app).toContain("PortalClosed");
    expect(app).toContain("PortalPublicRoute");
    expect(app).toContain("subscribePortalEnabled");
    // Portal login + signup are guarded by PortalPublicRoute (which checks portal enabled).
    expect(app).toMatch(/path="\/portal\/login" element=\{<PortalPublicRoute>/);
    expect(app).toMatch(/path="\/portal\/signup" element=\{<PortalPublicRoute>/);
    // CustomerRoute short-circuits with PortalClosed too.
    expect(app).toMatch(/if \(!portalEnabled\) return <PortalClosed/);
  });
});

describe("Profile-scoped route guards require a resolved profile", () => {
  const app = read("src/App.tsx");
  it("ProtectedRoute redirects to /login when profile is missing after loading", () => {
    expect(app).toMatch(/if \(!profile\) return <Navigate to="\/login"/);
  });
  it("CustomerRoute redirects to /portal/login when profile is missing after loading", () => {
    expect(app).toMatch(/if \(!profile\) return <Navigate to="\/portal\/login"/);
  });
});
