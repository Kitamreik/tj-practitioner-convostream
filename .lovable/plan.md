## Scope

Three deliverables:

1. **Embeddable chat widget** — a single `<script>` tag customers paste on their site that opens a chat bubble, captures visitor identity, creates a Firestore `conversations` doc, and streams customer messages into the existing thread store consumed by `/conversations`.
2. **Legal, privacy & compliance pages** — Terms of Service, Privacy Policy, Cookie Policy, DPA, plus account-level rights (export, delete) and a cookie consent banner gating non-essential cookies.
3. **Global site footer** — rendered on every authenticated page and on public widget/legal pages, linking the legal pages and showing a brief cookie-usage notice.

No changes to existing agent workflow logic — widget messages flow into the same `conversations` collection so agents see them in their normal inbox.

---

## 1. Embeddable Web Chat Widget

### Hosting model

- The widget is a self-contained vanilla-JS bundle served from the app's own origin (`/widget/v1/convohub-widget.js`), built by Vite as a separate library entry. No React on the customer's site — keeps payload small and avoids version conflicts.
- Customer install snippet:
  ```html
  <script async src="https://<app-domain>/widget/v1/convohub-widget.js"
          data-tenant="<tenantId>"
          data-color="#E07A5F"></script>
  ```
- The widget injects an isolated Shadow DOM container so customer-site CSS cannot leak in.

### UX

- Floating bubble bottom-right; click opens a 360×520 panel.
- First-run form: name + email (required) + optional phone, plus a checkbox: "I agree to the Terms and Privacy Policy" linking to the hosted pages. Submit creates the thread.
- Subsequent visits: `localStorage` key `convohub.widget.session` holds `{ conversationId, visitorId, name, email }` so the same thread resumes.
- Message list streams via Firestore `onSnapshot` on `conversations/{id}/messages` (read-only listener scoped to that one doc).
- Typing area + send button. Outbound messages write to the same subcollection with `sender: "customer"`, `channel: "web"`.
- Minimize / close controls; unread bubble badge.

### Backend wiring

- New Cloud Function `createWidgetConversation` (HTTPS, public, App Check + reCAPTCHA v3 token required) that:
  - Validates tenantId, name, email, consent flag.
  - Creates a `conversations` doc with `source: "web-widget"`, `channel: "web"`, `status: "waiting"`, `customerName`, `customerEmail`, `consent: { acceptedAt, ip, userAgent }`.
  - Returns `{ conversationId, visitorToken }` (short-lived signed token).
- New Cloud Function `postWidgetMessage` that accepts `{ conversationId, visitorToken, body }`, validates token + length (≤2000 chars), writes to `messages` subcollection, bumps `lastMessageAt`.
- Firestore rules: widget reads/writes are denied to anonymous clients; only the callables (running with admin SDK) can write widget-origin docs. Authenticated staff continue to read/write per existing rules.
- Rate limit: 10 messages/min per `visitorToken` enforced server-side via a `widgetRateLimits/{visitorToken}` doc.

### Integration with existing agent UI

- `Conversations.tsx` already lists every doc in `conversations`. Widget threads appear automatically. Add a small "Web" channel badge driven by `channel === "web"` in `RoleBadge`/conversation row. Agent replies write to the same subcollection with `sender: "agent"`; the widget listener renders them live.

### Files

- `widget/src/main.ts` — vanilla TS entry, Shadow DOM, fetch-only Firebase REST calls (no full SDK to keep bundle <40KB gzipped).
- `widget/src/styles.css` — scoped widget styles.
- `vite.widget.config.ts` — separate library build outputting `public/widget/v1/convohub-widget.js`.
- `functions/src/widget.ts` — `createWidgetConversation`, `postWidgetMessage` callables, exported from `functions/src/index.ts`.
- Update `firestore.rules` to allow staff reads on widget docs and deny direct client writes.
- New `/widget-install` page in the app showing the snippet + tenant id for admins/webmasters.

---

## 2. Legal, Privacy & Compliance

### Public legal pages (no auth required)

- `/legal/terms` — Terms of Service
- `/legal/privacy` — Privacy Policy (covers data collected, lawful basis, retention, sub-processors: Firebase, Slack, Gmail; user rights under GDPR/CCPA)
- `/legal/cookies` — Cookie Policy listing each cookie/localStorage key used (auth session, theme, widget session, consent record)
- `/legal/dpa` — Data Processing Addendum summary + downloadable PDF placeholder
- `/legal/acceptable-use` — Acceptable Use Policy

All rendered from a shared `LegalLayout` with prose styling and "Last updated" date.

### Cookie consent

- New `CookieConsent` component shown on first visit (any route, public or authed). Stores choice in `localStorage` key `convohub.consent.v1` = `{ essential: true, analytics: bool, acceptedAt }`.
- "Accept all" / "Essential only" / "Customize" buttons.
- The widget script reads the same key when embedded on `convohub.dev` itself; on third-party sites the widget shows its own mini-consent line in the intake form (already covered above).
- Re-open via footer "Cookie preferences" link.

### Data subject rights (in `/settings`)

- New "Privacy & data" card with:
  - **Export my data** — calls a new `exportMyData` callable that returns a JSON dump of the user's profile + audit entries authored by them; downloaded as `convohub-export-<uid>.json`.
  - **Delete my account** — calls `requestAccountDeletion`, which marks the profile `deletionRequestedAt`, revokes sessions, and queues a hard-delete after 30 days (existing soft-delete utilities reused). Webmasters cannot self-delete the only webmaster — guard included.
- For widget visitors: link in widget footer to email `privacy@<domain>` with their `visitorId` so staff can run the same export/delete.

### Audit log extension

- Append new audit actions: `consent_recorded`, `data_export_requested`, `account_deletion_requested`, `widget_conversation_created` so the existing AuditLogs page surfaces compliance events.

### Security/abuse

- Add Firebase App Check enforcement for the new widget callables (already noted in B2C audit).
- All new callables go through `sanitizeText` + zod schemas; reject payloads >5KB.

---

## 3. Global Footer

- New `SiteFooter.tsx` rendered:
  - Inside `AppLayout` below `<Outlet />` (sticks to bottom of scroll area, not fixed) so every authenticated page shows it.
  - Inside the public `LegalLayout` for legal pages.
  - Inside `Login`, `ForgotPassword`, `ResetPassword`, `Bootstrap` via a shared `PublicLayout` wrapper.
- Contents (responsive: 1 column mobile, 4 columns ≥md):
  - Brand block: ConvoHub mark + tagline + © year.
  - Product: Conversations, Chat, Analytics (links hidden when unauthenticated).
  - Legal: Terms, Privacy, Cookie Policy, DPA, Acceptable Use.
  - Contact: support email, status page placeholder, "Cookie preferences" button (re-opens consent modal).
- Bottom strip: short notice — "We use essential cookies to run ConvoHub and optional analytics cookies with your consent. See our Cookie Policy."
- Honors existing warm aesthetic (amber/coral accents, Playfair display headings, DM Sans body) and full light/dark mode via design tokens.

---

## Technical details

- Routing additions in `App.tsx`: `/legal/*` (public), `/widget-install` (escalated/admin), wrap public auth routes in `PublicLayout`.
- Vite config: add `build.rollupOptions.input` entry for widget OR a second `vite build --config vite.widget.config.ts` step; emit to `public/widget/v1/`.
- Firestore schema additions on `conversations`: `source`, `channel`, `consent`, `visitorId`, `widgetTenantId`. All optional → no migration required for legacy docs.
- New Cloud Functions exported from `functions/src/index.ts`: `createWidgetConversation`, `postWidgetMessage`, `exportMyData`, `requestAccountDeletion`. All include CORS for the customer-site origin (`*` for widget endpoints, locked origin for the in-app calls).
- Update `storage.rules` is unchanged (no file uploads in widget v1).
- Tests:
  - `src/test/cookieConsent.test.ts` — consent persistence + re-open flow.
  - `src/test/widgetSession.test.ts` — visitor session hydration + token expiry.
  - `src/test/legalRoutes.test.tsx` — legal pages render without auth.
- Update `mem://index.md` with: footer present on every page; `/legal/*` is public; widget bundle path is stable at `/widget/v1/convohub-widget.js`.

### Out of scope (call out for follow-up)

- File attachments inside the widget.
- Multi-tenant customer accounts / per-tenant theming beyond `data-color`.
- Stripe billing for widget usage tiers.
- Localized legal copy — English only in v1.