/**
 * Slugify utilities for Slack-channel conversations so they're addressable
 * via /conversations#<slug> as a bookmarkable archive alternative to the
 * canonical /conversations/:id URL.
 *
 * Slug format: lowercased customer/channel name, non-alphanumerics → "-",
 * collapsed and trimmed. Mirrors common URL-fragment conventions
 * ("Back-end Automation Test" → "back-end-automation-test").
 *
 * Collisions: when two Slack conversations share the same slug, we keep
 * the first one (sorted by timestamp desc) reachable by the bare slug and
 * never silently route to the wrong thread — the resolver returns null
 * for ambiguous slugs and the caller surfaces a toast.
 */

export function slugifyConversationName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export interface SlackSluggable {
  id: string;
  customerName?: string | null;
  channel?: string | null;
  timestamp?: { toMillis?: () => number } | null;
}

/**
 * Build a slug → conversation-id map for the Slack-channel subset only.
 * Sorted by timestamp desc so the freshest thread wins a slug collision.
 * Returns:
 *   - bySlug: stable lookup for resolving #hash → id
 *   - duplicateSlugs: set of slugs that map to >1 conversation (caller
 *     can warn the user and force them to use the canonical /:id URL).
 */
export function buildSlackSlugIndex<T extends SlackSluggable>(rows: T[]): {
  bySlug: Map<string, T>;
  duplicateSlugs: Set<string>;
} {
  const sorted = [...rows]
    .filter((r) => (r.channel ?? "") === "slack")
    .sort((a, b) => {
      const ta = a.timestamp?.toMillis?.() ?? 0;
      const tb = b.timestamp?.toMillis?.() ?? 0;
      return tb - ta;
    });

  const bySlug = new Map<string, T>();
  const seen = new Set<string>();
  const duplicateSlugs = new Set<string>();
  for (const row of sorted) {
    const slug = slugifyConversationName(row.customerName ?? "");
    if (!slug) continue;
    if (seen.has(slug)) {
      duplicateSlugs.add(slug);
      continue;
    }
    seen.add(slug);
    bySlug.set(slug, row);
  }
  return { bySlug, duplicateSlugs };
}
