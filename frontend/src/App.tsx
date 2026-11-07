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
  signals?: SymbolItem[];
  imports?: string[];
  lines?: number;
  complexity_estimate?: number | null;
  parser?: string;
};
type DependencyEdge = { from: string; to: string; specifier: string };
type DependencyGraph = {
  summary: {
    files_mapped: number;
    internal_dependencies: number;
    files_with_dependencies: number;
    most_depended_on: number;
    unresolved_relative_imports: number;
  };
  nodes: string[];
  edges: DependencyEdge[];
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
  dependency_graph?: DependencyGraph;
};
type SavedSnapshot = { id:string; savedAt:string; project_name:string; summary:AnalysisResult["summary"]; languages:LanguageStat[]; files:ProjectFile[]; codeSummary:CodeInsights["summary"]; edges:DependencyEdge[] };
type HealthFinding = { severity:"medium"|"info"; title:string; detail:string; path?:string };
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
  code_insights?: CodeInsights;
  safety: {
    source_executed: boolean;
    source_contents_read: boolean;
    note: string;
  };
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

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
  const [githubRepo,setGithubRepo]=useState("");
  const [isImportingRepo,setIsImportingRepo]=useState(false);
  const [savedSnapshots,setSavedSnapshots]=useState<SavedSnapshot[]>(()=>{try{return JSON.parse(localStorage.getItem("orbit-snapshots-v1")||"[]") as SavedSnapshot[]}catch{return[]}});
  const [selectedBaseline,setSelectedBaseline]=useState("");

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

  async function analyzeUpload(selectedUpload: File) {
    setAnalysis(null); setError(""); setSearchQuery(""); setLanguageFilter("All languages"); setSelectedFolder("All files"); setSelectedFile(null); setCollapsedFolders([]);
    if (!selectedUpload.name.toLowerCase().endsWith(".zip")) { setError("Choose a ZIP archive to analyze."); return; }
    if (selectedUpload.size > MAX_UPLOAD_BYTES) { setError("That ZIP exceeds ORBIT's 50 MB upload limit."); return; }
    if (!API_BASE_URL) { setError("The API address is not configured for this deployment."); return; }
    const formData=new FormData(); formData.append("file",selectedUpload); setIsAnalyzing(true);
    try { const response=await fetch(`${API_BASE_URL}/analyze/upload`,{method:"POST",body:formData}); const data=await response.json(); if(!response.ok)throw new Error(data.detail||"The project could not be analyzed."); const result=data as AnalysisResult; setAnalysis(result); setSelectedFile(result.files[0]||null); }
    catch(err){setError(err instanceof Error?err.message:"Something went wrong. Please try again.");}
    finally{setIsAnalyzing(false);}
  }
  async function handleFileChange(event:ChangeEvent<HTMLInputElement>){const file=event.target.files?.[0];event.target.value="";if(file)await analyzeUpload(file);}
  async function importGithubRepository(){
    const match=githubRepo.trim().match(/^https?:\\/\\/github\\.com\\/([A-Za-z0-9_.-]+)\\/([A-Za-z0-9_.-]+)(?:\\.git)?(?:[/?#].*)?$/i);
    if(!match){setError("Enter a public GitHub URL, e.g. https://github.com/owner/repository.");return;}
    setError("");setIsImportingRepo(true);
    try{const repo=match[2].replace(/\\.git$/i,"");const response=await fetch(`https://api.github.com/repos/${match[1]}/${repo}/zipball`,{headers:{Accept:"application/vnd.github+json"}});
      if(!response.ok)throw new Error(response.status===404?"Repository not found or not public.":`GitHub returned ${response.status}. Try uploading a ZIP instead.`);
      const blob=await response.blob();if(blob.size>MAX_UPLOAD_BYTES)throw new Error("This repository archive exceeds ORBIT's 50 MB upload limit.");
      await analyzeUpload(new File([blob],`${repo}.zip`,{type:"application/zip"}));
    }catch(err){setError(err instanceof Error?err.message:"Could not import that GitHub repository.");}finally{setIsImportingRepo(false);}
  }
  function saveCurrentSnapshot(){
    if(!analysis)return;
    const snapshot:SavedSnapshot={id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,savedAt:new Date().toISOString(),project_name:analysis.project_name,summary:analysis.summary,languages:analysis.languages,files:analysis.files,codeSummary:analysis.code_insights?.summary||{files_analyzed:0,functions_found:0,classes_found:0,imports_found:0,source_files_skipped_or_over_limit:0},edges:analysis.code_insights?.dependency_graph?.edges||[]};
    const next=[snapshot,...savedSnapshots].slice(0,20);setSavedSnapshots(next);
    try{localStorage.setItem("orbit-snapshots-v1",JSON.stringify(next));}catch{setError("Browser storage is full. Remove older snapshots or save a smaller project.");}
  }
  function exportReport(){
    if(!analysis)return;
    const report={generated_at:new Date().toISOString(),product:"ORBIT Developer Intelligence",project:analysis.project_name,summary:analysis.summary,languages:analysis.languages,code_insights:analysis.code_insights?.summary||null,dependency_summary:analysis.code_insights?.dependency_graph?.summary||null,findings:healthFindings,notes:["Static best-effort analysis only.","Uploaded code was not executed.","This report is not a security audit."]};
    const blob=new Blob([JSON.stringify(report,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=`${analysis.project_name.replace(/[^a-z0-9-_]+/gi,"-")}-orbit-report.json`;anchor.click();URL.revokeObjectURL(url);
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
      const insight=analysis.code_insights?.files.find(item=>item.path===file.path);const searchable=[file.path,file.language,insight?.functions?.map(item=>item.name).join(" "),insight?.classes?.map(item=>item.name).join(" "),insight?.imports?.join(" ")].join(" ").toLowerCase();const matchesSearch=!query||searchable.includes(query);
      const matchesLanguage = languageFilter === "All languages" || file.language === languageFilter;
      const folder = normalizeFolder(selectedFolder);
      const matchesFolder = selectedFolder === "All files" || file.path.startsWith(`${folder}/`) || file.path === folder;
      return matchesSearch && matchesLanguage && matchesFolder;
    });
  }, [analysis, searchQuery, languageFilter, selectedFolder]);

  const codeInsights = analysis?.code_insights || {
    summary: { files_analyzed: 0, functions_found: 0, classes_found: 0, imports_found: 0, source_files_skipped_or_over_limit: 0 },
    files: [],
    supported_languages: ["Python", "JavaScript", "TypeScript"],
  };
  const selectedCodeInsight = useMemo(
    () => analysis?.code_insights?.files.find((item) => item.path === selectedFile?.path) || null,
    [analysis, selectedFile],
  );
  const dependencyGraph = codeInsights.dependency_graph;
  const selectedOutgoing = dependencyGraph?.edges.filter((edge) => edge.from === selectedFile?.path) || [];
  const selectedIncoming = dependencyGraph?.edges.filter((edge) => edge.to === selectedFile?.path) || [];
  const healthFindings=useMemo<HealthFinding[]>(()=>{if(!analysis)return[];const f:HealthFinding[]=[];const insights=analysis.code_insights;const parse=insights?.files.filter(x=>x.status==="parse_error")||[];const skipped=insights?.summary.source_files_skipped_or_over_limit||0;const unresolved=insights?.dependency_graph?.summary.unresolved_relative_imports||0;const complex=(insights?.files||[]).filter(x=>(x.complexity_estimate||0)>=15);const large=analysis.files.filter(x=>x.size_bytes>=100*1024);
    if(parse.length)f.push({severity:"medium",title:"Files with parsing errors",detail:`${parse.length} supported source file(s) could not be parsed. Check syntax or parser compatibility.`,path:parse[0].path});
    if(skipped)f.push({severity:"medium",title:"Source files skipped",detail:`${skipped} source file(s) were outside analyzer size or total-analysis limits.`});
    if(unresolved)f.push({severity:"medium",title:"Unresolved local imports",detail:`${unresolved} relative import(s) could not be linked to a file in this archive.`});
    if(complex.length)f.push({severity:"info",title:"High branch-count estimates",detail:`${complex.length} file(s) have an estimated branch count of 15 or more. This is a rough signal, not a complexity score.`,path:complex[0].path});
    if(large.length)f.push({severity:"info",title:"Large files to review",detail:`${large.length} file(s) are at least 100 KB. Consider whether any would benefit from smaller modules.`,path:large.sort((a,b)=>b.size_bytes-a.size_bytes)[0].path});
    if(!f.length)f.push({severity:"info",title:"No structural flags detected",detail:"Current static checks found no parsing errors, skipped source files, unresolved local imports, or unusually large files. This is not a guarantee of correctness or security."});return f;},[analysis]);
  const structureScore=Math.max(0,100-healthFindings.reduce((score,item)=>score+(item.severity==="medium"?12:item.title==="No structural flags detected"?0:5),0));
  const graphNodes=useMemo(()=>{if(!dependencyGraph)return[];const names=dependencyGraph.nodes.length?dependencyGraph.nodes:[...new Set(dependencyGraph.edges.flatMap(e=>[e.from,e.to]))];return names.slice(0,28).map((path,index,all)=>{const angle=2*Math.PI*index/Math.max(all.length,1)-Math.PI/2;return{path,x:400+Math.cos(angle)*(all.length>1?178:0),y:245+Math.sin(angle)*(all.length>1?178:0)};});},[dependencyGraph]);
  const graphPosition=new Map(graphNodes.map(node=>[node.path,node]));
  const baseline=savedSnapshots.find(snapshot=>snapshot.id===selectedBaseline);const baselinePaths=new Set(baseline?.files.map(f=>f.path)||[]);const currentPaths=new Set(analysis?.files.map(f=>f.path)||[]);
  const addedFiles=analysis?analysis.files.filter(f=>!baselinePaths.has(f.path)):[];const removedFiles=baseline?baseline.files.filter(f=>!currentPaths.has(f.path)):[];
  const currentEdges=new Set(dependencyGraph?.edges.map(e=>`${e.from}→${e.to}`)||[]);const baselineEdges=new Set(baseline?.edges.map(e=>`${e.from}→${e.to}`)||[]);
  const addedEdges=[...currentEdges].filter(e=>!baselineEdges.has(e));const removedEdges=[...baselineEdges].filter(e=>!currentEdges.has(e));

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
            <p className="section-copy">Upload a ZIP to map your project structure, code, and internal dependencies. Godot projects are supported.</p>
          </div>
          <span className="step-tag">01 / INVENTORY</span>
        </div>

        <label className={`upload-zone ${isAnalyzing ? "upload-disabled" : ""}`}>
          <input type="file" accept=".zip,application/zip" onChange={handleFileChange} disabled={isAnalyzing || apiState !== "online"} />
          <span className="upload-icon">↑</span>
          <strong>{isAnalyzing ? "Analyzing project…" : analysis ? "Analyze another project" : "Choose a ZIP archive"}</strong>
          <span>{isAnalyzing ? "Reading archive structure" : "Select a project ZIP · Maximum 50 MB"}</span>
          <span className="upload-action">{isAnalyzing ? "PLEASE WAIT" : "SELECT PROJECT"}</span>
        </label>
        <p className="upload-guidance">Godot tip: ZIP the project folder containing project.godot. ORBIT skips the generated .godot cache automatically. Keep the ZIP under 50 MB.</p>
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
                <span className="explorer-count">{codeInsights.summary.files_analyzed} source files analyzed</span>
              </div>
              <div className="insight-metrics">
                <div><strong>{codeInsights.summary.functions_found}</strong><span>Functions</span></div>
                <div><strong>{codeInsights.summary.classes_found}</strong><span>Classes</span></div>
                <div><strong>{codeInsights.summary.imports_found}</strong><span>Imports</span></div>
                <div><strong>{codeInsights.summary.source_files_skipped_or_over_limit}</strong><span>Skipped</span></div>
              </div>
              {!analysis.code_insights ? (
                <p className="insight-empty">The inventory API responded, but static code analysis is not available on the connected backend yet. Your project inventory is still available.</p>
              ) : selectedCodeInsight ? (
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
                      {selectedCodeInsight.signals?.length ? (
                        <div className="imports-block"><h5>Signals <span>{selectedCodeInsight.signals.length}</span></h5>
                          <div className="import-chips">{selectedCodeInsight.signals.map((signal) => <code key={signal.name + signal.line}>{signal.name} · line {signal.line}</code>)}</div>
                        </div>
                      ) : null}
                      <div className="imports-block"><h5>Imports <span>{selectedCodeInsight.imports?.length || 0}</span></h5>
                        {selectedCodeInsight.imports?.length ? <div className="import-chips">{selectedCodeInsight.imports.map((item) => <code key={item}>{item}</code>)}</div> : <p className="symbol-empty">No imports detected.</p>}
                      </div>
                      <div className="analysis-footline"><span>{selectedCodeInsight.lines || 0} lines</span><span>{selectedCodeInsight.parser}</span>{selectedCodeInsight.complexity_estimate !== null && selectedCodeInsight.complexity_estimate !== undefined && <span>Branch estimate: {selectedCodeInsight.complexity_estimate}</span>}</div>
                    </>
                  ) : <p className="symbol-empty">{selectedCodeInsight.error || selectedCodeInsight.reason || "This file could not be analyzed."}</p>}
                </div>
              ) : (
                <p className="insight-empty">Select a supported GDScript, Python, JavaScript, or TypeScript file in the explorer to inspect its functions, classes, and imports. Supported parsers: {codeInsights.supported_languages.join(", ")}.</p>
              )}
              <p className="explorer-footnote">Static analysis is best-effort. JavaScript and TypeScript symbols are detected heuristically; this is not a full compiler or security audit.</p>
            </section>

            {dependencyGraph && (
              <section className="dependency-panel">
                <div className="explorer-heading">
                  <div><p className="eyebrow">PROJECT CONNECTIONS</p><h4>Dependency map</h4></div>
                  <span className="explorer-count">{dependencyGraph.summary.internal_dependencies} internal links</span>
                </div>
                <div className="insight-metrics dependency-metrics">
                  <div><strong>{dependencyGraph.summary.files_mapped}</strong><span>Files mapped</span></div>
                  <div><strong>{dependencyGraph.summary.internal_dependencies}</strong><span>Internal links</span></div>
                  <div><strong>{dependencyGraph.summary.files_with_dependencies}</strong><span>Files importing others</span></div>
                  <div><strong>{dependencyGraph.summary.unresolved_relative_imports}</strong><span>Unresolved local imports</span></div>
                </div>
                {selectedFile ? (
                  <div className="dependency-columns">
                    <div className="dependency-list">
                      <h5>Depends on <span>{selectedOutgoing.length}</span></h5>
                      {selectedOutgoing.length ? selectedOutgoing.map((edge) => (
                        <div className="dependency-row" key={edge.from + edge.to + edge.specifier}><span className="dependency-arrow">→</span><code>{edge.to}</code><small>{edge.specifier}</small></div>
                      )) : <p className="symbol-empty">No resolved internal dependencies from this file.</p>}
                    </div>
                    <div className="dependency-list">
                      <h5>Used by <span>{selectedIncoming.length}</span></h5>
                      {selectedIncoming.length ? selectedIncoming.map((edge) => (
                        <div className="dependency-row" key={edge.from + edge.to + edge.specifier}><span className="dependency-arrow">←</span><code>{edge.from}</code><small>{edge.specifier}</small></div>
                      )) : <p className="symbol-empty">No resolved internal dependencies point to this file.</p>}
                    </div>
                  </div>
                ) : <p className="insight-empty">Select a file in the explorer to see what it depends on and which files depend on it.</p>}
                <div className="dependency-all">
                  <h5>Detected connections <span>showing {Math.min(dependencyGraph.edges.length, 40)} of {dependencyGraph.edges.length}</span></h5>
                  {dependencyGraph.edges.length ? dependencyGraph.edges.slice(0, 40).map((edge) => (
                    <div className="dependency-row" key={edge.from + edge.to + edge.specifier}><code>{edge.from}</code><span className="dependency-arrow">→</span><code>{edge.to}</code></div>
                  )) : <p className="symbol-empty">No internal file connections were resolved in this project.</p>}
                </div>
                <p className="explorer-footnote">This map includes only imports that ORBIT could resolve to files inside the uploaded project. It is a static best-effort map, not a complete runtime call graph.</p>
              </section>
            )}

            <p className="safety-note">✓ {analysis.safety.note}</p>
          </div>
        )}
      </section>

      <section className="feature-grid" aria-label="ORBIT capabilities">
        <article className="feature-card"><span className="feature-number">01</span><h2>Project explorer</h2><p>Search, filter, and navigate folders and files in an interactive workspace.</p></article>
        <article className="feature-card"><span className="feature-number">02</span><h2>Language profile</h2><p>Understand which languages and file types make up a project.</p></article>
        <article className="feature-card"><span className="feature-number">03</span><h2>Code insights</h2><p>Inspect functions, classes, imports, and basic structural metrics in supported source files.</p></article>
        <article className="feature-card"><span className="feature-number">04</span><h2>Dependency map</h2><p>Trace resolved internal imports and see which files rely on one another.</p></article>
      </section>

      <footer><span>ORBIT / EARLY BUILD</span><span>Designed to inspect, never execute.</span></footer>
    </main>
  );
}

export default App;
