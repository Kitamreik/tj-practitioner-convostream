/**
 * useIntegrationsHealth — subscribes to `system/integrationsHealth`, the
 * server-managed doc updated by the every-5-days scheduled health check
 * (and on every manual run from /integrations).
 *
 * Returns `null` while loading or when the caller can't read the doc
 * (Firestore rules: webmaster-only). The AppSidebar/BottomNav use the
 * `anyFailing` flag to render a tiny red dot on the Integrations link so
 * problems surface even before the webmaster opens /integrations.
 */
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface IntegrationsHealthSummary {
  anyFailing: boolean;
  failingProviders: string[];
  checkedAtMs: number | null;
  source: "manual" | "scheduled" | null;
}

export function useIntegrationsHealth(enabled: boolean): IntegrationsHealthSummary | null {
  const [summary, setSummary] = useState<IntegrationsHealthSummary | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSummary(null);
      return;
    }
    const unsub = onSnapshot(
      doc(db, "system", "integrationsHealth"),
      (snap) => {
        if (!snap.exists()) {
          setSummary(null);
          return;
        }
        const d = snap.data() as {
          anyFailing?: boolean;
          failingProviders?: string[];
          checkedAtMs?: number;
          source?: "manual" | "scheduled";
        };
        setSummary({
          anyFailing: !!d.anyFailing,
          failingProviders: Array.isArray(d.failingProviders) ? d.failingProviders : [],
          checkedAtMs: typeof d.checkedAtMs === "number" ? d.checkedAtMs : null,
          source: d.source ?? null,
        });
      },
      (err) => {
        // Permission denied for non-webmasters (expected) — render nothing.
        console.warn("integrations health listener:", err);
        setSummary(null);
      }
    );
    return unsub;
  }, [enabled]);

  return summary;
}
