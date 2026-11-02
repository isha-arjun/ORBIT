import { useEffect, useState } from "react";

type ApiState = "checking" | "online" | "offline";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

function App() {
  const [apiState, setApiState] = useState<ApiState>("checking");

  useEffect(() => {
    let active = true;

    async function checkApi() {
      if (!API_BASE_URL) {
        if (active) setApiState("offline");
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/health`);
        if (!response.ok) throw new Error("API health check failed");

        const data: { status?: string; service?: string } = await response.json();
        if (data.status !== "ok" || data.service !== "orbit-api") {
          throw new Error("Unexpected API response");
        }

        if (active) setApiState("online");
      } catch {
        if (active) setApiState("offline");
      }
    }

    checkApi();
    return () => {
      active = false;
    };
  }, []);

  const statusLabel = {
    checking: "Checking API connection…",
    online: "Backend connected · API operational",
    offline: "Backend connection unavailable",
  }[apiState];

  return (
    <main className="shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="ORBIT home">
          <span className="wordmark-mark">O</span>
          ORBIT
        </a>
        <span className="topbar-label">DEVELOPER INTELLIGENCE</span>
      </header>

      <section className="hero">
        <p className="eyebrow">YOUR CODEBASE, UNDERSTOOD</p>
        <h1>See the structure<br />behind your software.</h1>
        <p className="intro">
          ORBIT will map project structure, identify languages, and surface
          useful engineering insights — without executing your code.
        </p>
        <div className={`status status-${apiState}`} role="status" aria-live="polite">
          <span className="status-dot" />
          {statusLabel}
        </div>
      </section>

      <section className="feature-grid" aria-label="Planned capabilities">
        <article className="feature-card">
          <span className="feature-number">01</span>
          <h2>Project map</h2>
          <p>Explore folders and files through a clear structural view.</p>
        </article>
        <article className="feature-card">
          <span className="feature-number">02</span>
          <h2>Language profile</h2>
          <p>Understand which languages and file types make up a project.</p>
        </article>
        <article className="feature-card">
          <span className="feature-number">03</span>
          <h2>Code insights</h2>
          <p>Build toward complexity and dependency analysis.</p>
        </article>
      </section>

      <footer>
        <span>ORBIT / EARLY BUILD</span>
        <span>Designed to inspect, never execute.</span>
      </footer>
    </main>
  );
}

export default App;
