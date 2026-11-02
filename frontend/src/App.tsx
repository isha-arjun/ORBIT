import { ChangeEvent, useEffect, useState } from "react";

type ApiState = "checking" | "online" | "offline";

type LanguageStat = { name: string; files: number };
type ProjectFile = {
  path: string;
  name: string;
  extension: string;
  language: string;
  size_bytes: number;
};
type AnalysisResult = {
  project_name: string;
  summary: {
    files_scanned: number;
    folders_found: number;
    total_uncompressed_bytes: number;
    languages_detected: number;
  };
  languages: LanguageStat[];
  folders: string[];
  files: ProjectFile[];
  safety: {
    source_executed: boolean;
    source_contents_read: boolean;
    note: string;
  };
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function App() {
  const [apiState, setApiState] = useState<ApiState>("checking");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");

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
    return () => { active = false; };
  }, []);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    event.target.value = "";
    if (!selectedFile) return;

    setAnalysis(null);
    setError("");

    if (!selectedFile.name.toLowerCase().endsWith(".zip")) {
      setError("Choose a ZIP archive to analyze.");
      return;
    }
    if (selectedFile.size > MAX_UPLOAD_BYTES) {
      setError("That ZIP is larger than the 15 MB upload limit.");
      return;
    }
    if (!API_BASE_URL) {
      setError("The API address is not configured for this deployment.");
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);
    setIsAnalyzing(true);
    try {
      const response = await fetch(`${API_BASE_URL}/analyze/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "The project could not be analyzed.");
      }
      setAnalysis(data as AnalysisResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  }

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
          Map a project, identify its languages, and get a first look at its
          structure — without executing its code.
        </p>
        <div className={`status status-${apiState}`} role="status" aria-live="polite">
          <span className="status-dot" />
          {statusLabel}
        </div>
      </section>

      <section className="analyzer-card" aria-labelledby="analyzer-title">
        <div className="analyzer-heading">
          <div>
            <p className="eyebrow">FIRST ANALYSIS TOOL</p>
            <h2 id="analyzer-title">Map your project</h2>
            <p className="section-copy">Upload a ZIP and ORBIT will build a file inventory and language profile.</p>
          </div>
          <span className="step-tag">01 / INVENTORY</span>
        </div>

        <label className={`upload-zone ${isAnalyzing ? "upload-disabled" : ""}`}>
          <input
            type="file"
            accept=".zip,application/zip"
            onChange={handleFileChange}
            disabled={isAnalyzing || apiState !== "online"}
          />
          <span className="upload-icon">↑</span>
          <strong>{isAnalyzing ? "Analyzing project…" : "Choose a ZIP archive"}</strong>
          <span>{isAnalyzing ? "Reading archive structure" : "Select a project ZIP · Maximum 15 MB"}</span>
          <span className="upload-action">{isAnalyzing ? "PLEASE WAIT" : "SELECT PROJECT"}</span>
        </label>

        {apiState !== "online" && (
          <p className="helper-text">The analyzer becomes available when the backend is connected.</p>
        )}
        {error && <p className="error-message" role="alert">{error}</p>}

        {analysis && (
          <div className="results" aria-live="polite">
            <div className="results-title">
              <div>
                <p className="eyebrow">ANALYSIS COMPLETE</p>
                <h3>{analysis.project_name}</h3>
              </div>
              <span className="complete-tag">INVENTORY READY</span>
            </div>

            <div className="metric-grid">
              <div className="metric"><strong>{analysis.summary.files_scanned.toLocaleString()}</strong><span>Files scanned</span></div>
              <div className="metric"><strong>{analysis.summary.folders_found.toLocaleString()}</strong><span>Folders found</span></div>
              <div className="metric"><strong>{analysis.summary.languages_detected}</strong><span>Languages</span></div>
              <div className="metric"><strong>{formatBytes(analysis.summary.total_uncompressed_bytes)}</strong><span>Project size</span></div>
            </div>

            <div className="result-columns">
              <section className="result-panel">
                <h4>Language profile</h4>
                <div className="language-list">
                  {analysis.languages.map((language) => {
                    const percent = Math.max(2, (language.files / analysis.summary.files_scanned) * 100);
                    return (
                      <div className="language-row" key={language.name}>
                        <div className="language-label"><span>{language.name}</span><span>{language.files}</span></div>
                        <div className="bar-track"><div className="bar-fill" style={{ width: `${percent}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="result-panel">
                <h4>Folder map <span>{analysis.folders.length}</span></h4>
                {analysis.folders.length ? (
                  <ul className="folder-list">
                    {analysis.folders.slice(0, 14).map((folder) => <li key={folder}>{folder}/</li>)}
                  </ul>
                ) : <p className="empty-state">No nested folders found.</p>}
                {analysis.folders.length > 14 && <p className="more-note">+ {analysis.folders.length - 14} more folders</p>}
              </section>
            </div>

            <section className="result-panel file-panel">
              <h4>File inventory <span>Showing {Math.min(analysis.files.length, 18)} of {analysis.files.length}</span></h4>
              <div className="file-list">
                {analysis.files.slice(0, 18).map((file) => (
                  <div className="file-row" key={file.path}>
                    <span className="file-name">{file.path}</span>
                    <span className="file-language">{file.language}</span>
                    <span className="file-size">{formatBytes(file.size_bytes)}</span>
                  </div>
                ))}
              </div>
            </section>

            <p className="safety-note">✓ {analysis.safety.note}</p>
          </div>
        )}
      </section>

      <section className="feature-grid" aria-label="ORBIT capabilities">
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
