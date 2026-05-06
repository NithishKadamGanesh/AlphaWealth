import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('UI runtime error:', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="app-shell error-shell">
          <div className="app-backdrop" />
          <div className="app-backdrop-grid" />
          <div className="app-backdrop-orb orb-a" />
          <div className="app-backdrop-orb orb-b" />
          <main className="error-boundary-panel">
            <div className="kicker">Runtime Error</div>
            <h1 className="error-title">The UI hit a render error instead of loading the workspace.</h1>
            <p className="spark-note">
              This is now being surfaced directly so we can diagnose it instead of failing to a blank screen.
            </p>
            <div className="soft-block error-block">
              <div className="summary-label">Message</div>
              <pre className="mono error-pre">{String(this.state.error?.stack || this.state.error?.message || this.state.error)}</pre>
            </div>
            <div className="error-actions">
              <button className="btn btn-primary" onClick={this.handleReload}>Reload UI</button>
            </div>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}
