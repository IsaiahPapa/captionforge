import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// Last line of defense: a render crash shows a way out instead of a blank
// window. "Close project" clears the autosaved draft in case it caused it.
class CrashScreen extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  async closeProject() {
    try {
      const state = await window.captionForge.loadState({ version: 1, project: null, userStylePresets: [], exportSettings: null });
      await window.captionForge.saveState({ ...state, project: null });
    } finally {
      window.location.reload();
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="welcome-shell">
        <section className="welcome-card">
          <h1>Something broke.</h1>
          <p>{this.state.error.message}</p>
          <button className="primary large" onClick={() => window.location.reload()}>Reload</button>
          <button className="text-button" onClick={() => this.closeProject()}>Close the project and reload</button>
        </section>
      </main>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CrashScreen>
      <App />
    </CrashScreen>
  </StrictMode>
);
