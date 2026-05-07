/**
 * Cookie / tracking consent management.
 *
 * Stores the user's choice in localStorage under `convohub.consent.v1`.
 * Essential cookies (auth, theme, widget session) are always-on; analytics
 * cookies require explicit opt-in. The footer "Cookie preferences" link
 * dispatches `convohub:open-consent` to re-open the banner.
 */
export const CONSENT_KEY = "convohub.consent.v1";
export const CONSENT_OPEN_EVENT = "convohub:open-consent";

export interface ConsentRecord {
  essential: true;
  analytics: boolean;
  acceptedAt: string; // ISO
  version: 1;
}

export function readConsent(): ConsentRecord | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentRecord>;
    if (parsed.version !== 1 || typeof parsed.acceptedAt !== "string") return null;
    return {
      essential: true,
      analytics: parsed.analytics === true,
      acceptedAt: parsed.acceptedAt,
      version: 1,
    };
  } catch {
    return null;
  }
}

export function writeConsent(analytics: boolean): ConsentRecord {
  const record: ConsentRecord = {
    essential: true,
    analytics,
    acceptedAt: new Date().toISOString(),
    version: 1,
  };
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
  } catch {
    // localStorage unavailable; consent will re-prompt next visit.
  }
  return record;
}

export function clearConsent(): void {
  try {
    localStorage.removeItem(CONSENT_KEY);
  } catch {
    /* noop */
  }
}

export function openConsentBanner(): void {
  try {
    window.dispatchEvent(new CustomEvent(CONSENT_OPEN_EVENT));
  } catch {
    /* noop */
  }
}
