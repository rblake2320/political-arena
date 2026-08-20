import React from "react";
import * as api from "../api";

/**
 * Route-level error boundary: a chunk-load failure or render throw shows a
 * recoverable panel instead of blanking the app, and the error is recorded
 * as a client_error analytics event so operators can see it.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    void api.trackEvent({
      event_type: "client_error",
      metadata: {
        message: String(error?.message || error).slice(0, 300),
        stack: String(error?.stack || "").slice(0, 500),
        component_stack: String(info?.componentStack || "").slice(0, 300),
        path: window.location.pathname,
      },
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: 520, margin: "0 auto", padding: "96px 16px", textAlign: "center" }}>
          <div style={{ font: "400 26px 'Instrument Serif',serif", color: "#F2F2F7", marginBottom: 8 }}>Something broke on this page</div>
          <div style={{ font: "400 13px 'IBM Plex Mono', ui-monospace, monospace", color: "#9B9BAB", marginBottom: 20 }}>
            The error was recorded. Reloading usually fixes it.
          </div>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ cursor: "pointer", font: "700 13px 'Hanken Grotesk',sans-serif", color: "#08080C", background: "#8F8FF9", border: "none", padding: "11px 20px", borderRadius: 9 }}
          >
            Reload the page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
