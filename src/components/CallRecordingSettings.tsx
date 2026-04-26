/**
 * CallRecordingSettings — admin/webmaster panel for the retention policy
 * and consent-banner copy that govern call recording.
 */

import React, { useEffect, useState } from "react";
import { ShieldCheck, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  subscribeRetentionPolicy,
  setRetentionPolicy,
  DEFAULT_RETENTION,
  type RetentionPolicy,
} from "@/lib/callRecordings";

const CallRecordingSettings: React.FC = () => {
  const { profile } = useAuth();
  const [policy, setPolicy] = useState<RetentionPolicy>(DEFAULT_RETENTION);
  const [retention, setRetention] = useState<number>(DEFAULT_RETENTION.retentionDays);
  const [requireConsent, setRequireConsent] = useState<boolean>(DEFAULT_RETENTION.requireConsent);
  const [consentText, setConsentText] = useState<string>(DEFAULT_RETENTION.consentText || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    return subscribeRetentionPolicy((p) => {
      setPolicy(p);
      setRetention(p.retentionDays);
      setRequireConsent(p.requireConsent);
      setConsentText(p.consentText || "");
    });
  }, []);

  const canEdit = profile?.role === "admin" || profile?.role === "webmaster";

  const onSave = async () => {
    if (!profile) return;
    if (retention < 0 || retention > 3650) {
      toast({ title: "Retention out of range", description: "Use 0 (forever) or 1–3650 days.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await setRetentionPolicy(
        {
          retentionDays: Math.floor(retention),
          requireConsent,
          consentText: consentText.trim() || DEFAULT_RETENTION.consentText,
        },
        profile.uid
      );
      toast({ title: "Saved", description: "Recording policy updated." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      toast({ title: "Could not save", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card id="call-recording-retention" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" /> Call recording & retention
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canEdit && (
          <p className="rounded-md border bg-muted/50 p-2 text-xs text-muted-foreground">
            Only admins and webmasters can change recording policy. Current values are read-only for you.
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="retention-days">Retention (days)</Label>
            <Input
              id="retention-days"
              type="number"
              min={0}
              max={3650}
              value={retention}
              onChange={(e) => setRetention(Number(e.target.value))}
              disabled={!canEdit}
            />
            <p className="text-xs text-muted-foreground">
              Recordings older than this are deleted. Set to <code>0</code> to keep forever.
            </p>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center justify-between">
              <span>Require consent banner</span>
              <Switch checked={requireConsent} onCheckedChange={setRequireConsent} disabled={!canEdit} />
            </Label>
            <p className="text-xs text-muted-foreground">
              When on, agents must confirm consent before each recording starts.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="consent-text">Consent banner message</Label>
          <Textarea
            id="consent-text"
            rows={3}
            value={consentText}
            onChange={(e) => setConsentText(e.target.value)}
            disabled={!canEdit}
            placeholder={DEFAULT_RETENTION.consentText}
          />
        </div>

        {policy.updatedAt && (
          <p className="text-[11px] text-muted-foreground">
            Last updated {policy.updatedAt.toDate().toLocaleString()}
          </p>
        )}

        <div className="flex justify-end">
          <Button onClick={onSave} disabled={!canEdit || saving} size="sm">
            <Save className="mr-1 h-4 w-4" /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default CallRecordingSettings;
