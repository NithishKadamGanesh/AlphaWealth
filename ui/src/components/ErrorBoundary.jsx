import { Component } from "react";

/**
 * React Error Boundary — wraps the app so that a thrown render error in any
 * page doesn't blank the entire UI. Shows a small fallback with the error and
 * a "reload" button. We log to console so the underlying stack is still
 * available for debugging.
 *
 * Function components cannot define `componentDidCatch`, so this has to be a
 * class component. There is intentionally no third-party dependency here.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Log full stack to the console so developers can copy/paste it; the UI
    // shows only a short message to the user.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] render error:", error, info);
    this.setState({ info });
  }

  reset = () => {
    this.setState({ error: null, info: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    const { error, info } = this.state;
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink text-mist p-6">
        <div className="max-w-xl w-full rounded-2xl border border-red-500/30 bg-graphite/60 backdrop-blur p-6 space-y-4">
          <h1 className="text-xl font-semibold text-red-400">
            Something broke while rendering this page
          </h1>
          <p className="text-sm text-mist/80">
            The UI hit a runtime error. The data services are likely fine — try
            navigating back, or reload the app. The error has been logged to
            your browser console.
          </p>
          <pre className="text-xs bg-ink/60 p-3 rounded-lg overflow-auto max-h-40 text-red-300">
            {String(error?.message || error)}
          </pre>
          {info?.componentStack && (
            <details className="text-xs text-mist/60">
              <summary className="cursor-pointer">Component stack</summary>
              <pre className="mt-2 overflow-auto max-h-40">{info.componentStack}</pre>
            </details>
          )}
          <div className="flex gap-2">
            <button
              onClick={this.reset}
              className="px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-ink/60 hover:bg-ink/80 transition"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
