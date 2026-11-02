import { ChangeEvent, useEffect, useMemo, useState } from "react";

type ApiState = "checking" | "online" | "offline";
type LanguageStat = { name: string; files: number };
type ProjectFile = {
  path: string;
  name: string;
  extension: string;
  language: string;
  size_bytes: number;
};
type SymbolItem = { name: string; line: number; kind?: string };
type FileInsight = {
  path: string;
  status: string;
  error?: string;
  reason?: string;
  functions?: SymbolItem[];
  classes?: SymbolItem[];
  imports?: string[];
  lines?: number;
  complexity_estimate?: number | null;
  parser?: string;
};
type CodeInsights = {
  summary: {
    files_analyzed: number;
    functions_found: number;
    classes_found: number;
    imports_found: number;
    source_files_skipped_or_over_limit: number;
  };
  files: FileInsight[];
  supported_languages: string[];
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
  code_insights: CodeInsights;
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

function normalizeFolder(folder: string): string {
  return folder.replace(/\/+$/, "");
}

function App() {
  const [apiState, setApiState] = useState<ApiState>("checking");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [languageFilter, setLanguageFilter] = useState("All languages");
  const [selectedFolder, setSelectedFolder] = useState("All files");
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>([]);

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
        if (data.status !== "ok" || data.service !== "orbit-api") throw new Error("Unexpected API response");
        if (active) setApiState("online");
      } catch {
        if (active) setApiState("offline");
      }
    }
    checkApi();
    return () => { active = false; };
  }, []);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedUpload = event.target.files?.[0];
    event.target.value = "";
    if (!selectedUpload) return;
    setAnalysis(null);
    setError("");
    setSearchQuery("");
    setLanguageFilter("All languages");
    setSelectedFolder("All files");
    setSelectedFile(null);
    setCollapsedFolders([]);

    if (!selectedUpload.name.toLowerCase().endsWith(".zip")) {
      setError("Choose a ZIP archive to analyze.");
      return;
    }
    if (selectedUpload.size > MAX_UPLOAD_BYTES) {
      setError("That ZIP is larger than the 15 MB upload limit.");
      return;
    }
    if (!API_BASE_URL) {
      setError("The API address is not configured for this deployment.");
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedUpload);
    setIsAnalyzing(true);
    try {
      const response = await fetch(`${API_BASE_URL}/analyze/upload`, { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "The project could not be analyzed.");
      const result = data as AnalysisResult;
      setAnalysis(result);
      setSelectedFile(result.files[0] || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  const folderItems = useMemo(() => {
    if (!analysis) return [];
    return [...new Set(analysis.folders.map(normalizeFolder).filter(Boolean))].sort((a, b) => {
      const depthA = a.split("/").length;
      const depthB = b.split("/").length;
      return depthA - depthB || a.localeCompare(b);
    });
  }, [analysis]);

  const visibleFolders = useMemo(() => folderItems.filter((folder) => {
    const parts = folder.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      const parent = parts.slice(0, i).join("/");
      if (collapsedFolders.includes(parent)) return false;
    }
    return true;
  }), [folderItems, collapsedFolders]);

  const filteredFiles = useMemo(() => {
    if (!analysis) return [];
    const query = searchQuery.trim().toLowerCase();
    return analysis.files.filter((file) => {
      const matchesSearch = !query || file.path.toLowerCase().includes(query) || file.language.toLowerCase().includes(query);
      const matchesLanguage = languageFilter === "All languages" || file.language === languageFilter;
      const folder = normalizeFolder(selectedFolder);
      const matchesFolder = selectedFolder === "All files" || file.path.startsWith(`${folder}/`) || file.path === folder;
      return matchesSearch && matchesLanguage && matchesFolder;
    });
  }, [analysis, searchQuery, languageFilter, selectedFolder]);

  const selectedCodeInsight = useMemo(
    () => analysis?.code_insights.files.find((item) => item.path === selectedFile?.path) || null,
    [analysis, selectedFile],
  );

  const statusLabel = {
    checking: "Checking API connection…",
    online: "Backend connected · API operational",
    offline: "Backend connection unavailable",
  }[apiState];

  function toggleFolder(folder: string) {
    setCollapsedFolders((current) => current.includes(folder)
      ? current.filter((item) => item !== folder)
      : [...current, folder]);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="ORBIT home"><span className="wordmark-mark">O</span>ORBIT</a>
        <span className="topbar-label">DEVELOPER INTELLIGENCE</span>
      </header>

      <section className="hero">
        <p className="eyebrow">YOUR CODEBASE, UNDERSTOOD</p>
        <h1>See the structure<br />behind your software.</h1>
        <p className="intro">Map a project, identify its languages, and explore its structure — without executing its code.</p>
        <div className={`status status-${apiState}`} role="status" aria-live="polite"><span className="status-dot" />{statusLabel}</div>
      </section>

      <section className="analyzer-card" aria-labelledby="analyzer-title">
        <div className="analyzer-heading">
          <div>
            <p className="eyebrow">PROJECT ANALYSIS</p>
            <h2 id="analyzer-title">Map your project</h2>
            <p className="section-copy">Upload a ZIP to build an interactive file explorer and language profile.</p>
          </div>
          <span className="step-tag">01 / INVENTORY</span>
        </div>

        <label className={`upload-zone ${isAnalyzing ? "upload-disabled" : ""}`}>
          <input type="file" accept=".zip,application/zip" onChange={handleFileChange} disabled={isAnalyzing || apiState !== "online"} />
          <span className="upload-icon">↑</span>
          <strong>{isAnalyzing ? "Analyzing project…" : analysis ? "Analyze another project" : "Choose a ZIP archive"}</strong>
          <span>{isAnalyzing ? "Reading archive structure" : "Select a project ZIP · Maximum 15 MB"}</span>
          <span className="upload-action">{isAnalyzing ? "PLEASE WAIT" : "SELECT PROJECT"}</span>
        </label>
        {apiState !== "online" && <p className="helper-text">The analyzer becomes available when the backend is connected.</p>}
        {error && <p className="error-message" role="alert">{error}</p>}

        {analysis && (
          <div className="results" aria-live="polite">
            <div className="results-title">
              <div><p className="eyebrow">ANALYSIS COMPLETE</p><h3>{analysis.project_name}</h3></div>
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
                    const percent = analysis.summary.files_scanned ? Math.max(2, (language.files / analysis.summary.files_scanned) * 100) : 0;
                    return <div className="language-row" key={language.name}>
                      <div className="language-label"><span>{language.name}</span><span>{language.files}</span></div>
                      <div className="bar-track"><div className="bar-fill" style={{ width: `${percent}%` }} /></div>
                    </div>;
                  })}
                </div>
              </section>
              <section className="result-panel">
                <h4>Project overview <span>{folderItems.length} folders</span></h4>
                <p className="overview-copy">Browse the folder tree below, filter files by language, or search for a filename or path.</p>
                <div className="overview-stats"><span><strong>{analysis.files.length}</strong> indexed files</span><span><strong>{analysis.languages.length}</strong> detected languages</span></div>
              </section>
            </div>

            <section className="explorer-panel">
              <div className="explorer-heading">
                <div><p className="eyebrow">INTERACTIVE EXPLORER</p><h4>Project files</h4></div>
                <span className="explorer-count">{filteredFiles.length} / {analysis.files.length} files</span>
              </div>
              <div className="explorer-toolbar">
                <label className="search-field"><span>⌕</span><input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search files, paths, languages…" aria-label="Search project files" /></label>
                <select className="language-select" value={languageFilter} onChange={(e) => setLanguageFilter(e.target.value)} aria-label="Filter by language">
                  <option>All languages</option>
                  {analysis.languages.map((language) => <option key={language.name} value={language.name}>{language.name}</option>)}
                </select>
              </div>

              <div className="explorer-layout">
                <aside className="folder-sidebar" aria-label="Project folders">
                  <button className={`folder-choice root-choice ${selectedFolder === "All files" ? "selected" : ""}`} onClick={() => setSelectedFolder("All files")}>
                    <span className="folder-glyph">◫</span><span>All files</span><span className="folder-total">{analysis.files.length}</span>
                  </button>
                  {visibleFolders.map((folder) => {
                    const depth = folder.split("/").length - 1;
                    const hasChildren = folderItems.some((candidate) => candidate.startsWith(`${folder}/`));
                    const isCollapsed = collapsedFolders.includes(folder);
                    const folderCount = analysis.files.filter((file) => file.path.startsWith(`${folder}/`)).length;
                    return <div className="folder-tree-row" key={folder} style={{ paddingLeft: `${depth * 13}px` }}>
                      <button className={`folder-choice ${selectedFolder === folder ? "selected" : ""}`} onClick={() => setSelectedFolder(folder)} title={folder}>
                        <span className="folder-glyph">▰</span><span className="folder-label">{folder.split("/").pop()}</span><span className="folder-total">{folderCount}</span>
                      </button>
                      {hasChildren && <button className="folder-toggle" onClick={() => toggleFolder(folder)} aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${folder}`}>{isCollapsed ? "＋" : "−"}</button>}
                    </div>;
                  })}
                </aside>

                <div className="explorer-main">
                  <div className="file-table-head"><span>NAME</span><span>LANGUAGE</span><span>SIZE</span></div>
                  {filteredFiles.length ? <div className="explorer-file-list">
                    {filteredFiles.map((file) => <button key={file.path} className={`explorer-file-row ${selectedFile?.path === file.path ? "active" : ""}`} onClick={() => setSelectedFile(file)}>
                      <span className="explorer-file-name"><span className="file-icon">◇</span>{file.name}<small>{file.path}</small></span>
                      <span className="explorer-file-language">{file.language}</span>
                      <span className="explorer-file-size">{formatBytes(file.size_bytes)}</span>
                    </button>)}
                  </div> : <div className="explorer-empty">No files match these filters. Try another search or folder.</div>}
                </div>
              </div>

              {selectedFile && <div className="file-detail">
                <div className="detail-icon">◇</div>
                <div className="detail-content"><span className="detail-kicker">SELECTED FILE</span><strong>{selectedFile.name}</strong><code>{selectedFile.path}</code></div>
                <div className="detail-meta"><span>{selectedFile.language}</span><span>{selectedFile.extension || "No extension"}</span><span>{formatBytes(selectedFile.size_bytes)}</span></div>
              </div>}
              <p className="explorer-footnote">Select a source file to see its detected structure. Source text is analyzed in memory and is not shown in the explorer.</p>
            </section>

            <section className="code-insights-panel">
              <div className="explorer-heading">
                <div><p className="eyebrow">STATIC ANALYSIS</p><h4>Code intelligence</h4></div>
                <span className="explorer-count">{analysis.code_insights.summary.files_analyzed} source files analyzed</span>
              </div>
              <div className="insight-metrics">
                <div><strong>{analysis.code_insights.summary.functions_found}</strong><span>Functions</span></div>
                <div><strong>{analysis.code_insights.summary.classes_found}</strong><span>Classes</span></div>
                <div><strong>{analysis.code_insights.summary.imports_found}</strong><span>Imports</span></div>
                <div><strong>{analysis.code_insights.summary.source_files_skipped_or_over_limit}</strong><span>Skipped</span></div>
              </div>
              {selectedCodeInsight ? (
                <div className="symbol-browser">
                  <div className="symbol-heading">
                    <div><span className="detail-kicker">FILE STRUCTURE</span><strong>{selectedCodeInsight.path}</strong></div>
                    <span className={selectedCodeInsight.status === "analyzed" ? "analysis-status" : "analysis-status muted"}>{selectedCodeInsight.status.replace("_", " ")}</span>
                  </div>
                  {selectedCodeInsight.status === "analyzed" ? (
                    <>
                      <div className="symbol-groups">
                        <div className="symbol-group">
                          <h5>Functions <span>{selectedCodeInsight.functions?.length || 0}</span></h5>
                          {selectedCodeInsight.functions?.length ? selectedCodeInsight.functions.map((symbol, index) => (
                            <div className="symbol-row" key={symbol.name + symbol.line + index}><span className="symbol-kind">{symbol.kind || "function"}</span><strong>{symbol.name}()</strong><small>Line {symbol.line}</small></div>
                          )) : <p className="symbol-empty">No functions detected.</p>}
                        </div>
                        <div className="symbol-group">
                          <h5>Classes <span>{selectedCodeInsight.classes?.length || 0}</span></h5>
                          {selectedCodeInsight.classes?.length ? selectedCodeInsight.classes.map((symbol, index) => (
                            <div className="symbol-row" key={symbol.name + symbol.line + index}><span className="symbol-kind">class</span><strong>{symbol.name}</strong><small>Line {symbol.line}</small></div>
                          )) : <p className="symbol-empty">No classes detected.</p>}
                        </div>
                      </div>
                      <div className="imports-block"><h5>Imports <span>{selectedCodeInsight.imports?.length || 0}</span></h5>
                        {selectedCodeInsight.imports?.length ? <div className="import-chips">{selectedCodeInsight.imports.map((item) => <code key={item}>{item}</code>)}</div> : <p className="symbol-empty">No imports detected.</p>}
                      </div>
                      <div className="analysis-footline"><span>{selectedCodeInsight.lines || 0} lines</span><span>{selectedCodeInsight.parser}</span>{selectedCodeInsight.complexity_estimate !== null && selectedCodeInsight.complexity_estimate !== undefined && <span>Branch estimate: {selectedCodeInsight.complexity_estimate}</span>}</div>
                    </>
                  ) : <p className="symbol-empty">{selectedCodeInsight.error || selectedCodeInsight.reason || "This file could not be analyzed."}</p>}
                </div>
              ) : (
                <p className="insight-empty">Select a supported Python, JavaScript, or TypeScript file in the explorer to inspect its functions, classes, and imports. Supported parsers: {analysis.code_insights.supported_languages.join(", ")}.</p>
              )}
              <p className="explorer-footnote">Static analysis is best-effort. JavaScript and TypeScript symbols are detected heuristically; this is not a full compiler or security audit.</p>
            </section>

            <p className="safety-note">✓ {analysis.safety.note}</p>
          </div>
        )}
      </section>

      <section className="feature-grid" aria-label="ORBIT capabilities">
        <article className="feature-card"><span className="feature-number">01</span><h2>Project explorer</h2><p>Search, filter, and navigate folders and files in an interactive workspace.</p></article>
        <article className="feature-card"><span className="feature-number">02</span><h2>Language profile</h2><p>Understand which languages and file types make up a project.</p></article>
        <article className="feature-card"><span className="feature-number">03</span><h2>Code insights</h2><p>Inspect functions, classes, imports, and basic structural metrics in supported source files.</p></article>
      </section>

      <footer><span>ORBIT / EARLY BUILD</span><span>Designed to inspect, never execute.</span></footer>
    </main>
  );
}

export default App;
