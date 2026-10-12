import { Component } from "react";
import { reportCrash } from "../utils/crashReporter";

// Contains a render crash to one workspace. Without it React unmounts the whole app and the
// desktop window goes black; with it the operator sees the error and can remount the panel.
export default class PanelErrorBoundary extends Component {
  state = { error: null, attempt: 0 };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportCrash(error, { boundary: this.props.name, componentStack: info?.componentStack }).catch(() => {});
  }

  render() {
    const { error, attempt } = this.state;
    if (!error) return <div key={attempt} style={{ display: "contents" }}>{this.props.children}</div>;
    return (
      <div role="alert" style={{ padding: 32, color: "var(--text-primary, #e6eef3)", maxWidth: 640 }}>
        <h2 style={{ marginTop: 0 }}>{this.props.name || "This workspace"} hit an error</h2>
        <p style={{ color: "var(--text-muted, #8aa0ad)" }}>
          The rest of AquaFlow is still running. Your show is kept in memory; reload the workspace to continue.
        </p>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, opacity: 0.8 }}>{String(error?.message || error)}</pre>
        <button onClick={() => this.setState({ error: null, attempt: attempt + 1 })}>Reload workspace</button>
      </div>
    );
  }
}
