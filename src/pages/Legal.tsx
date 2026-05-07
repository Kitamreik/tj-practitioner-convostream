import React from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { ArrowLeft, MessageCircle } from "lucide-react";
import SiteFooter from "@/components/SiteFooter";

const LAST_UPDATED = "May 7, 2026";

interface Doc {
  title: string;
  body: React.ReactNode;
}

const PROSE = "prose prose-sm md:prose-base max-w-none prose-headings:font-[Playfair_Display] prose-headings:text-foreground prose-p:text-foreground/90 prose-li:text-foreground/90 prose-a:text-primary";

const DOCS: Record<string, Doc> = {
  terms: {
    title: "Terms of Service",
    body: (
      <>
        <p>
          These Terms of Service ("Terms") govern your access to and use of ConvoHub
          (the "Service"). By creating an account or using the Service you agree to
          these Terms.
        </p>
        <h2>1. Accounts</h2>
        <p>
          You must provide accurate information when creating an account and are
          responsible for safeguarding your credentials. You may not share your
          account or use another person's account without permission.
        </p>
        <h2>2. Acceptable use</h2>
        <p>
          You agree not to use the Service to send unlawful, harassing, or infringing
          content, attempt to access data you are not authorized to view, or interfere
          with the Service's operation. See our{" "}
          <Link to="/legal/acceptable-use">Acceptable Use Policy</Link> for details.
        </p>
        <h2>3. Customer data</h2>
        <p>
          You retain ownership of conversations, messages, and customer information you
          submit ("Customer Data"). You grant ConvoHub a limited license to host,
          process, and transmit Customer Data solely to provide the Service.
        </p>
        <h2>4. Service availability</h2>
        <p>
          We work to keep the Service available but do not guarantee uninterrupted
          access. Scheduled maintenance and unforeseen incidents may cause downtime.
        </p>
        <h2>5. Termination</h2>
        <p>
          You may stop using the Service at any time. We may suspend or terminate
          accounts that violate these Terms. On termination, Customer Data is retained
          per our retention schedule (30 days for soft-deleted items) and then
          permanently removed.
        </p>
        <h2>6. Disclaimer & liability</h2>
        <p>
          The Service is provided "as is" without warranties of any kind. To the
          maximum extent permitted by law, ConvoHub's aggregate liability for any
          claim arising out of these Terms is limited to fees paid in the 12 months
          preceding the claim.
        </p>
        <h2>7. Changes</h2>
        <p>
          We may update these Terms. Material changes will be announced in-app at
          least 14 days before they take effect.
        </p>
        <h2>8. Contact</h2>
        <p>
          Questions: <a href="mailto:legal@convohub.dev">legal@convohub.dev</a>.
        </p>
      </>
    ),
  },
  privacy: {
    title: "Privacy Policy",
    body: (
      <>
        <p>
          This Privacy Policy explains how ConvoHub collects, uses, and shares
          personal information.
        </p>
        <h2>Information we collect</h2>
        <ul>
          <li><strong>Account data:</strong> name, email, role, password hash.</li>
          <li><strong>Conversation data:</strong> messages, attachments, customer contact details you record.</li>
          <li><strong>Usage data:</strong> pages visited, actions taken, device and browser metadata.</li>
          <li><strong>Audit data:</strong> sign-in attempts, role changes, integration events.</li>
        </ul>
        <h2>How we use it</h2>
        <p>
          To operate and improve the Service, authenticate you, route notifications,
          comply with legal obligations, and investigate security incidents.
        </p>
        <h2>Lawful basis (GDPR)</h2>
        <p>
          Performance of contract (delivering the Service), legitimate interests
          (security, product improvement), and consent (optional analytics cookies).
        </p>
        <h2>Sub-processors</h2>
        <ul>
          <li>Google Firebase — authentication, database, hosting.</li>
          <li>Slack — outbound webmaster alerts (when configured).</li>
          <li>Google Workspace (Gmail) — inbound email ingestion (when authorized).</li>
        </ul>
        <h2>Retention</h2>
        <p>
          Active conversations are retained for the life of your account. Soft-deleted
          items are purged after 30 days. Sign-in attempts are kept up to 90 days.
        </p>
        <h2>Your rights</h2>
        <p>
          You can access, export, correct, or delete your personal data from{" "}
          <Link to="/settings">Settings → Privacy &amp; data</Link>. EU/UK and California
          residents have additional rights under GDPR and CCPA respectively. We do not
          sell personal information.
        </p>
        <h2>International transfers</h2>
        <p>
          Data is processed in the United States and the European Union by our
          sub-processors under Standard Contractual Clauses where applicable.
        </p>
        <h2>Contact</h2>
        <p>
          Privacy requests: <a href="mailto:privacy@convohub.dev">privacy@convohub.dev</a>.
        </p>
      </>
    ),
  },
  cookies: {
    title: "Cookie Policy",
    body: (
      <>
        <p>
          ConvoHub uses cookies and equivalent local-storage entries to operate the
          Service and, with your consent, to measure usage.
        </p>
        <h2>Essential</h2>
        <ul>
          <li><code>firebase:authUser:*</code> — keeps you signed in.</li>
          <li><code>convohub.theme</code> — remembers light/dark preference.</li>
          <li><code>convohub.consent.v1</code> — records your cookie choices.</li>
          <li><code>convohub.widget.session</code> — resumes a customer chat thread on the embeddable widget.</li>
        </ul>
        <h2>Optional (analytics)</h2>
        <p>
          Anonymous product analytics. Loaded only after you click "Accept all" in the
          cookie banner. You can revoke consent any time via the footer's "Cookie
          preferences" link.
        </p>
        <h2>Third-party cookies</h2>
        <p>
          Authentication is handled by Firebase, which sets its own cookies on the
          authentication domain. We do not embed advertising trackers.
        </p>
      </>
    ),
  },
  dpa: {
    title: "Data Processing Addendum",
    body: (
      <>
        <p>
          This Data Processing Addendum ("DPA") forms part of the Terms of Service
          between ConvoHub ("Processor") and the Customer ("Controller") for the
          processing of personal data on behalf of the Controller.
        </p>
        <h2>Subject matter and duration</h2>
        <p>
          ConvoHub processes Customer Data to provide the Service for the duration of
          the agreement plus the 30-day retention window.
        </p>
        <h2>Nature and purpose</h2>
        <p>
          Hosting, indexing, transmitting, and displaying conversation content;
          delivering notifications; producing analytics for the Controller.
        </p>
        <h2>Categories of data subjects</h2>
        <p>Controller's customers, end-users, and staff members.</p>
        <h2>Controller obligations</h2>
        <p>
          Ensure a lawful basis exists for the data submitted; honor data-subject
          requests; configure access controls within the Service appropriately.
        </p>
        <h2>Security measures</h2>
        <p>
          Encryption in transit (TLS 1.2+), encryption at rest, role-based access,
          audit logging, least-privilege Cloud Function service accounts, and quarterly
          access reviews.
        </p>
        <h2>Sub-processors</h2>
        <p>
          See the Privacy Policy. Controller is notified of new sub-processors at
          least 30 days in advance and may object in writing.
        </p>
        <h2>International transfers</h2>
        <p>
          Standard Contractual Clauses apply to transfers outside the EEA/UK.
        </p>
        <h2>Sub-processor breach</h2>
        <p>
          ConvoHub will notify Controller without undue delay (within 72 hours) of a
          confirmed personal data breach.
        </p>
        <h2>Audit</h2>
        <p>
          Controller may request a summary of ConvoHub's most recent security review
          once per 12-month period.
        </p>
        <p>
          A countersigned PDF copy is available on request:{" "}
          <a href="mailto:privacy@convohub.dev">privacy@convohub.dev</a>.
        </p>
      </>
    ),
  },
  "acceptable-use": {
    title: "Acceptable Use Policy",
    body: (
      <>
        <p>You agree not to use the Service to:</p>
        <ul>
          <li>Send spam, phishing, or malware.</li>
          <li>Harass, threaten, or defame any person.</li>
          <li>Infringe intellectual-property or privacy rights.</li>
          <li>Attempt to gain unauthorized access, probe vulnerabilities, or interfere with other customers' use of the Service.</li>
          <li>Process special-category personal data (health, biometrics, etc.) without a separate written agreement.</li>
        </ul>
        <p>
          Suspected violations may result in suspension or termination. Report abuse
          to <a href="mailto:abuse@convohub.dev">abuse@convohub.dev</a>.
        </p>
      </>
    ),
  },
};

const LegalPage: React.FC = () => {
  const { slug } = useParams();
  const doc = slug ? DOCS[slug] : undefined;
  if (!doc) return <Navigate to="/legal/terms" replace />;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-card/40">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <MessageCircle className="h-4 w-4 text-primary-foreground" />
            </div>
            <span
              className="text-lg font-semibold text-foreground"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              ConvoHub
            </span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" /> Back to app
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <article className="mx-auto max-w-4xl px-4 py-10">
          <h1
            className="text-3xl font-semibold text-foreground md:text-4xl"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {doc.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
          <div className={`mt-8 ${PROSE}`}>{doc.body}</div>

          <nav aria-label="Other policies" className="mt-12 flex flex-wrap gap-3 border-t border-border pt-6 text-sm">
            {Object.entries(DOCS).map(([key, d]) =>
              key === slug ? null : (
                <Link key={key} to={`/legal/${key}`} className="text-muted-foreground hover:text-primary">
                  {d.title}
                </Link>
              ),
            )}
          </nav>
        </article>
      </main>

      <SiteFooter variant="public" />
    </div>
  );
};

export default LegalPage;
