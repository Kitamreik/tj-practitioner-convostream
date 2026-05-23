/**
 * Heuristic extractor for the safeguarding checklist.
 *
 * When an agent converts a chat thread into a customer conversation, we scan
 * the most recent customer-authored messages for sentences that map onto one
 * of the four checklist items. The extractor is intentionally conservative:
 *
 *   - We never auto-tick a checkbox; we only seed the optional note so the
 *     agent still has to confirm before the item counts as acknowledged.
 *   - We cap each note at 240 chars and skip exact duplicates.
 *   - Matching is keyword-based on the message body — no AI calls, no PII
 *     scrubbing of the seed (the agent is expected to clean it up).
 *
 * Returned shape mirrors the ChecklistState document so callers can spread
 * it straight into Firestore at `{collection}/{id}/affirmations/harmImpact`.
 */
export type ChecklistSeed = {
  items: Record<string, { checked: boolean; note?: string }>;
};

interface SeedMessage {
  body: string;
  senderUid?: string;
  deleted?: boolean;
}

const KEYWORDS: Record<string, RegExp> = {
  harmedParties:
    /\b(hurt|harm(ed|ing)?|abuse[d]?|assault(ed)?|attack(ed)?|victim|impact(ed)?|affect(ed)?|bullie?d?|threat(en(ed)?)?)\b/i,
  supportTeam:
    /\b(therapist|counsell?or|family|mom|mum|dad|parent|sister|brother|friend|pastor|priest|advocate|case ?worker|social worker|doctor|nurse|sponsor|teacher|coach)\b/i,
  preferredComms:
    /\b(prefer|text me|call me|email me|reach me|contact me|don'?t call|please (call|text|email)|by (phone|text|email|sms))\b/i,
  triggers:
    /\b(trigger(s|ed|ing)?|avoid|can'?t (talk|hear|read)|don'?t want to (hear|see|talk)|sensitive (to|about)|please don'?t (mention|bring))\b/i,
};

const splitSentences = (text: string): string[] =>
  text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6 && s.length <= 400);

export function extractChecklistSeed(
  messages: SeedMessage[],
  agentUid: string,
  opts: { maxPerItem?: number } = {},
): ChecklistSeed {
  const maxPerItem = opts.maxPerItem ?? 2;
  const customerMsgs = messages.filter(
    (m) => !m.deleted && m.body?.trim() && m.senderUid !== agentUid,
  );
  // Walk newest-last so the freshest sentence wins on truncation.
  const buckets: Record<string, string[]> = {
    harmedParties: [],
    supportTeam: [],
    preferredComms: [],
    triggers: [],
  };
  for (const m of customerMsgs) {
    for (const sentence of splitSentences(m.body)) {
      for (const [key, re] of Object.entries(KEYWORDS)) {
        if (buckets[key].length >= maxPerItem) continue;
        if (re.test(sentence) && !buckets[key].includes(sentence)) {
          buckets[key].push(sentence);
        }
      }
    }
  }
  const items: ChecklistSeed["items"] = {};
  for (const [key, lines] of Object.entries(buckets)) {
    if (!lines.length) continue;
    const note = lines.join(" • ").slice(0, 240);
    items[key] = { checked: false, note };
  }
  return { items };
}

/** True if at least one checklist item was seeded. */
export const hasSeed = (s: ChecklistSeed | null | undefined): boolean =>
  !!s && Object.keys(s.items).length > 0;
