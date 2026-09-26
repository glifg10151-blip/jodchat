import { Component, type ReactNode, type ErrorInfo } from "react";
import { logError } from "../../utils/logger";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  hasRetried: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, hasRetried: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError("general", "Uncaught error in component", {
      error,
      details: info.componentStack ?? undefined,
      action: "Try reloading the app. If the problem persists, report this issue.",
    });
  }

  private retry = () => {
    this.setState({ hasError: false, error: null, hasRetried: true });
  };

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8" role="alert">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <svg
              className="w-7 h-7 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-text-primary">Something went wrong</h2>
          <p className="text-sm text-text-muted max-w-md text-center">
            {this.state.hasRetried
              ? "The app could not recover automatically. Reload it to start from a clean state."
              : "The current view could not be displayed. You can try once more or reload the app."}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {!this.state.hasRetried && (
              <button
                onClick={this.retry}
                className="px-4 py-2 rounded-lg border border-border text-text-primary text-sm font-medium hover:bg-hover transition-colors min-h-[44px]"
              >
                Try Again
              </button>
            )}
            <button
              onClick={this.reload}
              className="px-4 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent-hover transition-colors min-h-[44px]"
            >
              Reload App
            </button>
          </div>
          {this.state.error?.message && (
            <details className="max-w-md text-xs text-text-muted">
              <summary className="cursor-pointer text-center hover:text-text-primary">Technical details</summary>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface p-3 text-left font-mono">
                {this.state.error.message}
              </pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
