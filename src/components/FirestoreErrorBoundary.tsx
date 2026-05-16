import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface State {
  hasError: boolean;
  isFirestore: boolean;
  message: string;
}

/**
 * Top-level error boundary specialized for the Firestore SDK's
 * "INTERNAL ASSERTION FAILED" crashes (IDs ca9 / b815) that we've seen
 * surface from the watch-stream when the preview proxy drops a long-poll.
 * Instead of a blank white page, the user sees a friendly "Reconnecting…"
 * screen with a Reload button.
 *
 * Non-Firestore errors are also caught (so the app never blanks out),
 * but the copy stays generic for those.
 */
class FirestoreErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { hasError: false, isFirestore: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    const msg = error instanceof Error ? error.message : String(error);
    const isFirestore =
      /FIRESTORE/i.test(msg) ||
      /INTERNAL ASSERTION FAILED/i.test(msg) ||
      /ID:\s*(ca9|b815)/i.test(msg);
    return { hasError: true, isFirestore, message: msg };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // Surface to the dev console — Lovable mirrors these to the AI panel.
    // eslint-disable-next-line no-console
    console.error("FirestoreErrorBoundary caught:", error, info);
  }

  private handleReload = () => {
    // Full reload re-initializes the Firestore client and clears any
    // dangling watch-stream targets that triggered the assertion.
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const title = this.state.isFirestore ? "Reconnecting…" : "Something went wrong";
    const body = this.state.isFirestore
      ? "We lost the realtime connection to ConvoHub. This usually clears up after a quick reload."
      : "An unexpected error interrupted the page. Reloading should bring you back.";

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <AlertTriangle className="h-6 w-6 text-primary" />
          </div>
          <h1
            className="mb-2 text-2xl font-semibold text-card-foreground"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {title}
          </h1>
          <p className="mb-6 text-sm text-muted-foreground">{body}</p>
          <Button onClick={this.handleReload} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Reload ConvoHub
          </Button>
          {this.state.message && (
            <details className="mt-6 text-left text-xs text-muted-foreground/80">
              <summary className="cursor-pointer select-none">Technical details</summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3">
                {this.state.message}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}

export default FirestoreErrorBoundary;
