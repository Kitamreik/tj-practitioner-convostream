import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ShieldAlert, TrendingUp, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * FlagAnalyticsPanel — admin/webmaster view summarising flag_alert volume
 * over the last 14 days plus the most frequently triggered terms. Backed by
 * a live Firestore listener so counts stay current.
 *
 * Visibility is decided by the parent (only mount for admin/webmaster).
 */

interface FlagAlertDoc {
  id: string;
  matches?: string[];
  createdAt?: any;
  reviewStatus?: "open" | "in_review" | "resolved";
  authorName?: string;
}

const DAYS = 14;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const FlagAnalyticsPanel: React.FC = () => {
  const [alerts, setAlerts] = useState<FlagAlertDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "staff_updates"),
      where("kind", "==", "flag_alert"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setError(null);
        setAlerts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        setLoading(false);
      },
      (err) => {
        console.warn("FlagAnalyticsPanel listener error:", err);
        setError("Could not load flag alert analytics.");
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  const { buckets, topTerms, openCount, totalMatches } = useMemo(() => {
    const now = new Date();
    const buckets: { date: Date; key: string; count: number }[] = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      buckets.push({ date: d, key: dayKey(d), count: 0 });
    }
    const bucketIdx = new Map(buckets.map((b, i) => [b.key, i]));
    const termCounts = new Map<string, number>();
    let openCount = 0;
    let totalMatches = 0;

    for (const a of alerts) {
      const ts: Date | null = a.createdAt?.toDate ? a.createdAt.toDate() : null;
      if (ts) {
        const key = dayKey(new Date(ts.getFullYear(), ts.getMonth(), ts.getDate()));
        const idx = bucketIdx.get(key);
        if (idx !== undefined) buckets[idx].count += 1;
      }
      const matches = Array.isArray(a.matches) ? a.matches : [];
      for (const m of matches) {
        const key = String(m).toLowerCase().trim();
        if (!key) continue;
        termCounts.set(key, (termCounts.get(key) ?? 0) + 1);
        totalMatches += 1;
      }
      if (!a.reviewStatus || a.reviewStatus === "open") openCount += 1;
    }

    const topTerms = Array.from(termCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);

    return { buckets, topTerms, openCount, totalMatches };
  }, [alerts]);

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const totalIn14 = buckets.reduce((sum, b) => sum + b.count, 0);

  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            Flagged language analytics
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Auto-flagged outgoing messages over the last {DAYS} days.
          </p>
        </div>
        <Badge variant="secondary" className="gap-1.5 text-xs">
          <TrendingUp className="h-3 w-3" /> {alerts.length} total
        </Badge>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Stat label={`Last ${DAYS} days`} value={totalIn14} />
            <Stat label="Open / unreviewed" value={openCount} tone="warn" />
            <Stat label="Total matches" value={totalMatches} />
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Volume by day
            </p>
            {totalIn14 === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No flagged messages in this period. 🎉
              </p>
            ) : (
              <div className="flex items-end gap-1 h-32">
                {buckets.map((b) => {
                  const pct = b.count === 0 ? 0 : Math.max(6, (b.count / maxCount) * 100);
                  return (
                    <div
                      key={b.key}
                      className="flex-1 flex flex-col items-center justify-end group"
                      title={`${shortLabel(b.date)}: ${b.count}`}
                    >
                      <div
                        className={`w-full rounded-t transition-colors ${b.count > 0 ? "bg-destructive/70 group-hover:bg-destructive" : "bg-muted"}`}
                        style={{ height: `${pct}%` }}
                      />
                      <span className="mt-1 text-[9px] text-muted-foreground truncate w-full text-center">
                        {b.date.getDate()}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Most-triggered terms
            </p>
            {topTerms.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No term data yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {topTerms.map(([term, count]) => {
                  const pct = (count / topTerms[0][1]) * 100;
                  return (
                    <li key={term} className="flex items-center gap-2 text-xs">
                      <span className="w-32 truncate font-mono text-foreground">{term}</span>
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-destructive/70"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-8 text-right tabular-nums text-muted-foreground">{count}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
};

const Stat: React.FC<{ label: string; value: number; tone?: "warn" }> = ({ label, value, tone }) => (
  <div className="rounded-lg border border-border bg-background/40 p-3">
    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className={`mt-1 text-xl font-semibold ${tone === "warn" && value > 0 ? "text-warning" : "text-foreground"}`}>
      {value}
    </p>
  </div>
);

export default FlagAnalyticsPanel;
