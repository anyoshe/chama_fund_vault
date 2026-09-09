import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ChamaVault UI error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-center text-slate-100">
          <h1 className="text-xl font-bold text-white">Something went wrong</h1>
          <p className="mt-2 max-w-md text-sm text-slate-400">
            {this.state.error.message || "Unexpected application error."}
          </p>
          <button
            type="button"
            className="mt-6 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white"
            onClick={() => {
              this.setState({ error: null });
              window.location.href = "/app";
            }}
          >
            Reload app
          </button>
          <p className="mt-4 text-[11px] text-slate-600">
            Support: {import.meta.env.VITE_SUPPORT_EMAIL || "support@chamavault.local"}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
