import React from "react";
import { Link } from "react-router-dom";
import { Shield } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import SmokeTestPanel from "@/components/SmokeTestPanel";

/** Standalone /smoke-test route. Webmaster gate + reusable panel. */
const SmokeTest: React.FC = () => {
  const { profile } = useAuth();

  if (profile && profile.role !== "webmaster") {
    return (
      <div className="container mx-auto max-w-2xl p-6">
        <Card className="p-8 text-center">
          <Shield className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Webmaster only</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This smoke-test page verifies Firestore rules + functions and is restricted to webmasters.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/settings">Back to Settings</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return <SmokeTestPanel />;
};

export default SmokeTest;
