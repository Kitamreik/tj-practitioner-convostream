/**
 * Collapsible safeguarding checklist surfaced on every conversation and DM
 * thread. Four affirmations the agent should confirm before deep engagement:
 *
 *   1. Identified who has been impacted by harm
 *   2. Identified who is on the support team for this client
 *   3. Confirmed the client's preferred method of communication
 *   4. Logged potential triggers to avoid / watch for
 *
 * Each item supports an optional free-text note. State is persisted in
 * Firestore at `{collection}/{docId}/affirmations/harmImpact` so it follows
 * the conversation across devices and operators.
 *
 * PRIVACY: Entries are masked behind the agent's account password by default.
 * They never render in the customer-facing portal (the parent decides whether
 * to mount this component). After re-auth, the unlock is cached in
 * sessionStorage for 15 minutes so the agent doesn't have to retype the
 * password every time they open the thread.
 */
import React, { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, ShieldCheck, Lock } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import SecurityReauthDialog from "@/components/SecurityReauthDialog";

export interface ChecklistItem {
  key: string;
  label: string;
  description: string;
}

const ITEMS: ChecklistItem[] = [
  {
    key: "harmedParties",
    label: "Identified who has been impacted by harm",
    description: "Direct and indirect parties — name roles, not identities, if sensitive.",
  },
  {
    key: "supportTeam",
    label: "Identified the client's support team",
    description: "Therapist, family, faith leader, advocate, case worker, etc.",
  },
  {
    key: "preferredComms",
    label: "Confirmed preferred communication channel",
    description: "How and when the client wants to be contacted (phone, email, SMS, app).",
  },
  {
    key: "triggers",
    label: "Logged potential triggers",
    description: "Topics, language, times of day, or content types to avoid.",
  },
];

interface Props {
  /** Parent collection — typically "conversations" or "chatThreads". */
  parentCollection: string;
  /** Parent document id. */
  parentId: string;
  defaultOpen?: boolean;
  /**
   * When true (default), the entire checklist is masked until the agent
   * re-enters their account password. Set false for trusted contexts where
   * a password gate would be friction (e.g. an admin tooling page).
   */
  requirePassword?: boolean;
}

interface ChecklistState {
  items: Record<string, { checked: boolean; note?: string }>;
  updatedBy?: string;
}

const UNLOCK_TTL_MS = 15 * 60 * 1000;
const unlockKey = (uid: string | undefined) =>
  `convohub.checklist.unlocked.${uid ?? "anon"}`;

function readUnlockedUntil(uid: string | undefined): number {
  try {
    const raw = sessionStorage.getItem(unlockKey(uid));
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeUnlockedUntil(uid: string | undefined, ts: number): void {
  try {
    sessionStorage.setItem(unlockKey(uid), String(ts));
  } catch {
    /* private mode */
  }
}

const HarmImpactChecklist: React.FC<Props> = ({
  parentCollection,
  parentId,
  defaultOpen,
  requirePassword = true,
}) => {
  const { profile } = useAuth();
  const [open, setOpen] = useState(!!defaultOpen);
  const [state, setState] = useState<ChecklistState>({ items: {} });
  const [saving, setSaving] = useState(false);

  // Password gate state (session-scoped, 15-min TTL).
  const [unlockedUntil, setUnlockedUntil] = useState<number>(() =>
    readUnlockedUntil(profile?.uid),
  );
  const [reauthOpen, setReauthOpen] = useState(false);
  const [failCount, setFailCount] = useState(0);

  const unlocked = useMemo(
    () => !requirePassword || unlockedUntil > Date.now(),
    [requirePassword, unlockedUntil],
  );

  useEffect(() => {
    setUnlockedUntil(readUnlockedUntil(profile?.uid));
  }, [profile?.uid]);

  // Only subscribe once the user has unlocked the panel so we don't pull
  // sensitive notes into memory under a locked screen.
  useEffect(() => {
    if (!parentId || !unlocked) return;
    const ref = doc(db, parentCollection, parentId, "affirmations", "harmImpact");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) setState(snap.data() as ChecklistState);
        else setState({ items: {} });
      },
      (err) => console.warn("HarmImpactChecklist subscribe failed:", err),
    );
    return () => unsub();
  }, [parentCollection, parentId, unlocked]);

  const completedCount = Object.values(state.items || {}).filter((v) => v?.checked).length;

  const update = async (next: ChecklistState) => {
    setSaving(true);
    try {
      const ref = doc(db, parentCollection, parentId, "affirmations", "harmImpact");
      await setDoc(
        ref,
        { ...next, updatedBy: profile?.displayName || profile?.uid || "agent", updatedAt: serverTimestamp() },
        { merge: true },
      );
    } catch (e: any) {
      toast({ title: "Could not save checklist", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: string, checked: boolean) => {
    const next: ChecklistState = {
      ...state,
      items: { ...(state.items || {}), [key]: { ...(state.items?.[key] || {}), checked } },
    };
    setState(next);
    void update(next);
  };

  const setNote = (key: string, note: string) => {
    const next: ChecklistState = {
      ...state,
      items: { ...(state.items || {}), [key]: { ...(state.items?.[key] || {}), checked: !!state.items?.[key]?.checked, note } },
    };
    setState(next);
  };

  const flushNote = (_key: string) => {
    void update(state);
  };

  const handleLock = () => {
    setUnlockedUntil(0);
    writeUnlockedUntil(profile?.uid, 0);
  };

  // Locked view — show a small notice + reveal button.
  if (!unlocked) {
    return (
      <>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-muted-foreground">
              Safeguarding checklist is masked — re-enter your password to view or edit.
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={() => setReauthOpen(true)}>
            Reveal
          </Button>
        </div>
        <SecurityReauthDialog
          open={reauthOpen}
          onOpenChange={setReauthOpen}
          onSuccess={() => {
            const until = Date.now() + UNLOCK_TTL_MS;
            setUnlockedUntil(until);
            writeUnlockedUntil(profile?.uid, until);
          }}
          onLockout={() => {
            toast({
              title: "Checklist locked",
              description: "Too many failed attempts. Try again later.",
              variant: "destructive",
            });
          }}
          failCount={failCount}
          setFailCount={setFailCount}
        />
      </>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border bg-card/50">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="flex w-full items-center justify-between gap-2 p-3 hover:bg-accent/40"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Safeguarding checklist
            <Badge variant={completedCount === ITEMS.length ? "default" : "secondary"} className="text-[10px]">
              {completedCount}/{ITEMS.length}
            </Badge>
          </span>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t border-border p-3">
        {ITEMS.map((item) => {
          const current = state.items?.[item.key];
          return (
            <div key={item.key} className="space-y-1.5">
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={!!current?.checked}
                  onCheckedChange={(v) => toggle(item.key, !!v)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.description}</span>
                </span>
              </label>
              <Textarea
                value={current?.note || ""}
                onChange={(e) => setNote(item.key, e.target.value)}
                onBlur={() => flushNote(item.key)}
                placeholder="Optional notes (no client identifiers)"
                className="ml-6 min-h-[44px] text-xs"
                maxLength={500}
              />
            </div>
          );
        })}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {saving ? "Saving…" : state.updatedBy ? `Last updated by ${state.updatedBy}` : "Not yet acknowledged."}
          </p>
          {requirePassword && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={handleLock}
            >
              <Lock className="h-3 w-3" /> Hide
            </Button>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default HarmImpactChecklist;
