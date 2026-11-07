import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { compareSnapshotFiles } from "./snapshotComparison.mjs";

type ApiState = "checking" | "online" | "offline";
type ApiVersion = { commit?:string; branch?:string; version?:string };
type GitCommit = {sha:string;message:string;author:string;date?:string;url?:string};
type RecentRepository = {owner:string;repository:string;lastOpened:string};
type LanguageStat = { name: string; files: number };
type ProjectFile = {
  path: string;
  name: string;
  extension: string;
  language: string;
  size_bytes: number;
  content_sha256?: string;
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
type MaintenanceFinding = { id:string; kind:string; severity:"medium"|"info"; title:string; detail:string; path?:string; line?:number; evidence?:string; confidence?:string; locations?:{path:string;line:number}[] };
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
  maintenance_findings?: MaintenanceFinding[];
};
type SavedSnapshot = { id:string; savedAt:string; project_name:string; summary:AnalysisResult["summary"]; languages:LanguageStat[]; files:ProjectFile[]; codeSummary:CodeInsights["summary"]; edges:DependencyEdge[]; analysis?:AnalysisResult };
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

type ArchitectureHotspot = { path:string; incoming:number; outgoing:number };
type ArchitectureInsights = { hotspots:ArchitectureHotspot[]; cycles:string[][]; connectedFiles:number };

function collectSymbols(files:FileInsight[]|undefined):string[]{
  if(!files)return[];
  return files.filter(file=>file.status==="analyzed").flatMap(file=>[
    ...(file.functions||[]).map(symbol=>`function · ${file.path} · ${symbol.name}`),
    ...(file.classes||[]).map(symbol=>`class · ${file.path} · ${symbol.name}`),
    ...(file.signals||[]).map(symbol=>`signal · ${file.path} · ${symbol.name}`),
  ]).sort((a,b)=>a.localeCompare(b));
}

function deriveArchitectureInsights(graph:DependencyGraph):ArchitectureInsights{
  const nodes=[...new Set(graph.nodes)];
  const adjacency=new Map(nodes.map(node=>[node,[] as string[]]));
  const reverse=new Map(nodes.map(node=>[node,[] as string[]]));
  const incoming=new Map(nodes.map(node=>[node,0]));
  const outgoing=new Map(nodes.map(node=>[node,0]));
  for(const edge of graph.edges){
    if(!adjacency.has(edge.from)){adjacency.set(edge.from,[]);reverse.set(edge.from,[]);incoming.set(edge.from,0);outgoing.set(edge.from,0);nodes.push(edge.from);}
    if(!adjacency.has(edge.to)){adjacency.set(edge.to,[]);reverse.set(edge.to,[]);incoming.set(edge.to,0);outgoing.set(edge.to,0);nodes.push(edge.to);}
    adjacency.get(edge.from)!.push(edge.to);
    reverse.get(edge.to)!.push(edge.from);
    outgoing.set(edge.from,(outgoing.get(edge.from)||0)+1);
    incoming.set(edge.to,(incoming.get(edge.to)||0)+1);
  }
  const visited=new Set<string>();
  const order:string[]=[];
  for(const start of nodes){
    if(visited.has(start))continue;
    visited.add(start);
    const stack:{node:string;index:number}[]=[{node:start,index:0}];
    while(stack.length){
      const frame=stack[stack.length-1];
      const neighbors=adjacency.get(frame.node)||[];
      if(frame.index<neighbors.length){
        const next=neighbors[frame.index++];
        if(!visited.has(next)){visited.add(next);stack.push({node:next,index:0});}
      }else{order.push(frame.node);stack.pop();}
    }
  }
  const assigned=new Set<string>();
  const cycles:string[][]=[];
  for(let i=order.length-1;i>=0;i--){
    const start=order[i];
    if(assigned.has(start))continue;
    const component:string[]=[];
    const stack=[start];assigned.add(start);
    while(stack.length){
      const node=stack.pop()!;component.push(node);
      for(const next of reverse.get(node)||[])if(!assigned.has(next)){assigned.add(next);stack.push(next);}
    }
    if(component.length>1)cycles.push(component.sort((a,b)=>a.localeCompare(b)));
  }
  const hotspots=nodes.map(path=>({path,incoming:incoming.get(path)||0,outgoing:outgoing.get(path)||0}))
    .filter(item=>item.incoming+item.outgoing>0)
    .sort((a,b)=>(b.incoming+b.outgoing)-(a.incoming+a.outgoing)||b.incoming-a.incoming||a.path.localeCompare(b.path))
    .slice(0,5);
  return{hotspots,cycles:cycles.sort((a,b)=>b.length-a.length).slice(0,5),connectedFiles:nodes.filter(path=>(incoming.get(path)||0)+(outgoing.get(path)||0)>0).length};
}

function App() {
  const [apiState, setApiState] = useState<ApiState>("checking");
  const [apiVersion,setApiVersion]=useState<ApiVersion|null>(null);
  const [theme,setTheme] = useState<"dark"|"light">(()=>{try{return localStorage.getItem("orbit-theme-v1")==="light"?"light":"dark"}catch{return"dark"}});
  useEffect(()=>{document.documentElement.setAttribute("data-theme",theme);document.querySelector('meta[name="theme-color"]')?.setAttribute("content",theme==="light"?"#f4f7fc":"#10131a");try{localStorage.setItem("orbit-theme-v1",theme)}catch{}},[theme]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [languageFilter, setLanguageFilter] = useState("All languages");
  const [selectedFolder, setSelectedFolder] = useState("All files");
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>([]);
  const [githubRepo,setGithubRepo]=useState("");
  const [recentRepositories,setRecentRepositories]=useState<RecentRepository[]>(()=>{try{return JSON.parse(localStorage.getItem("orbit-recent-repositories-v1")||"[]") as RecentRepository[]}catch{return[]}});
  const [githubHistory,setGithubHistory]=useState<{repository:string;default_branch?:string;commits:GitCommit[]}|null>(null);
  const [historyLoading,setHistoryLoading]=useState(false);
  const [historyError,setHistoryError]=useState("");
  const [historyQuery,setHistoryQuery]=useState("");
  const [isImportingRepo,setIsImportingRepo]=useState(false);
  const [savedSnapshots,setSavedSnapshots]=useState<SavedSnapshot[]>(()=>{try{return JSON.parse(localStorage.getItem("orbit-snapshots-v1")||"[]") as SavedSnapshot[]}catch{return[]}});
  const [selectedBaseline,setSelectedBaseline]=useState("");
  const [resolvedIssues,setResolvedIssues]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem("orbit-resolved-issues-v1")||"[]") as string[]}catch{return[]}});
  const [issueFilter,setIssueFilter]=useState<"all"|"open"|"resolved">("all");
  const [findingQuery,setFindingQuery]=useState("");
  const [findingSeverity,setFindingSeverity]=useState<"all"|"medium"|"info">("all");

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
        try {
          const versionResponse = await fetch(`${API_BASE_URL}/version`);
          if (versionResponse.ok) {
            const versionData: ApiVersion = await versionResponse.json();
            if (active) setApiVersion(versionData);
          }
        } catch { /* Version metadata is optional; health status remains authoritative. */ }
      } catch {
        if (active) setApiState("offline");
      }
    }
    checkApi();
    return () => { active = false; };
  }, []);

  async function analyzeUpload(selectedUpload: File) {
    setAnalysis(null); setGithubHistory(null); setError(""); setSearchQuery(""); setLanguageFilter("All languages"); setSelectedFolder("All files"); setSelectedFile(null); setCollapsedFolders([]);
    if (!selectedUpload.name.toLowerCase().endsWith(".zip")) { setError("Choose a ZIP archive to analyze."); return; }
    if (selectedUpload.size > MAX_UPLOAD_BYTES) { setError("That ZIP exceeds ORBIT's 50 MB upload limit."); return; }
    if (!API_BASE_URL) { setError("The API address is not configured for this deployment."); return; }
    const formData=new FormData(); formData.append("file",selectedUpload); setIsAnalyzing(true);
    try { const response=await fetch(`${API_BASE_URL}/analyze/upload`,{method:"POST",body:formData}); const data=await response.json(); if(!response.ok)throw new Error(data.detail||"The project could not be analyzed."); const result=data as AnalysisResult; setAnalysis(result); setSelectedFile(result.files[0]||null); }
    catch(err){setError(err instanceof Error?err.message:"Something went wrong. Please try again.");}
    finally{setIsAnalyzing(false);}
  }
  async function handleFileChange(event:ChangeEvent<HTMLInputElement>){const file=event.target.files?.[0];event.target.value="";if(file)await analyzeUpload(file);}
  async function loadGithubHistory(owner:string,repository:string){
    setHistoryLoading(true);setHistoryError("");setGithubHistory(null);setHistoryQuery("");
    try{
      const response=await fetch(API_BASE_URL+"/github/history",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({owner,repository})});
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(data?.detail||`History request failed (HTTP ${response.status}).`);
      if(!data||!Array.isArray(data.commits))throw new Error("The history service returned an unexpected response.");
      setGithubHistory({repository:data.repository||owner+"/"+repository,default_branch:data.default_branch,commits:data.commits});
    }catch(err){
      setGithubHistory({repository:owner+"/"+repository,commits:[]});
      setHistoryError(err instanceof Error?err.message:"Could not load commit history.");
    }finally{setHistoryLoading(false);}
  }

  async function importGithubRepository(){
    let parsed: URL;
    try { parsed = new URL(githubRepo.trim()); } catch { setError("Enter a valid public GitHub repository URL."); return; }
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parsed.hostname.toLowerCase() !== "github.com" || parts.length < 2 || !/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(parts[1])) {
      setError("Enter a public GitHub URL, e.g. https://github.com/owner/repository."); return;
    }
    const owner = parts[0];
    const repository = parts[1].toLowerCase().endsWith(".git") ? parts[1].slice(0,-4) : parts[1];
    if(!API_BASE_URL){setError("The API address is not configured for this deployment.");return;}
    setError(""); setIsImportingRepo(true); setAnalysis(null); setGithubHistory(null); setHistoryError(""); setSelectedBaseline("");
    try {
      const response = await fetch(`${API_BASE_URL}/analyze/github`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repository }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Repository import failed (HTTP ${response.status}).`);
      const result = data as AnalysisResult;
      const recent=[{owner,repository,lastOpened:new Date().toISOString()},...recentRepositories.filter(item=>!(item.owner.toLowerCase()===owner.toLowerCase()&&item.repository.toLowerCase()===repository.toLowerCase()))].slice(0,5);
      setRecentRepositories(recent);try{localStorage.setItem("orbit-recent-repositories-v1",JSON.stringify(recent));}catch{}
      setAnalysis(result); setSelectedFile(result.files[0] || null);
      setSearchQuery(""); setLanguageFilter("All languages"); setSelectedFolder("All files"); setCollapsedFolders([]);
      await loadGithubHistory(owner,repository);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import that GitHub repository.");
    } finally { setIsImportingRepo(false); }
  }

  function saveCurrentSnapshot(){
    if(!analysis)return;
    const snapshot:SavedSnapshot={id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,savedAt:new Date().toISOString(),project_name:analysis.project_name,summary:analysis.summary,languages:analysis.languages,files:analysis.files,codeSummary:analysis.code_insights?.summary||{files_analyzed:0,functions_found:0,classes_found:0,imports_found:0,source_files_skipped_or_over_limit:0},edges:analysis.code_insights?.dependency_graph?.edges||[],analysis};
    const next=[snapshot,...savedSnapshots].slice(0,20);setSavedSnapshots(next);
    try{localStorage.setItem("orbit-snapshots-v1",JSON.stringify(next));}catch{setError("Browser storage is full. Remove older snapshots or save a smaller project.");}
  }
  function loadSnapshot(snapshot:SavedSnapshot){
    if(!snapshot.analysis){setError("This older snapshot contains comparison data only. Analyze the project again to load a full workspace.");return;}
    setAnalysis(snapshot.analysis);setGithubHistory(null);setHistoryError("");setHistoryQuery("");setSelectedFile(snapshot.analysis.files[0]||null);setSelectedBaseline("");setSearchQuery("");setLanguageFilter("All languages");setSelectedFolder("All files");setError("");
  }
  function toggleIssueResolved(id:string){
    const next=resolvedIssues.includes(id)?resolvedIssues.filter(item=>item!==id):[...resolvedIssues,id];
    setResolvedIssues(next);try{localStorage.setItem("orbit-resolved-issues-v1",JSON.stringify(next));}catch{}
  }

  function exportReport(){
    if(!analysis)return;
    const report={
      schema_version:"1.1",
      generated_at:new Date().toISOString(),
      product:"ORBIT Developer Intelligence",
      project:analysis.project_name,
      health:{score:structureScore,review_flags:healthFindings.filter(item=>item.severity==="medium").length,observations:healthFindings.filter(item=>item.severity==="info").length,interpretation:"Heuristic structural indicator, not a quality or security grade."},
      summary:analysis.summary,
      languages:analysis.languages,
      inventory:{folders:analysis.folders,files:analysis.files.map(file=>({path:file.path,language:file.language,size_bytes:file.size_bytes,extension:file.extension}))},
      code_insights:analysis.code_insights?{summary:analysis.code_insights.summary,supported_languages:analysis.code_insights.supported_languages,files:analysis.code_insights.files,dependency_graph:analysis.code_insights.dependency_graph||null,maintenance_findings:analysis.code_insights.maintenance_findings||[]}:null,
      findings:allFindings.map(item=>({...item,resolved:resolvedIssues.includes(item.id)})),
      notes:["Static best-effort analysis only.","Uploaded code was not executed.","This report is not a security audit.","Symbol detection and dependency mapping are heuristic and may be incomplete."]
    };
    const blob=new Blob([JSON.stringify(report,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement("a");
    anchor.href=url;
    anchor.download=`${analysis.project_name.replace(/[^a-z0-9-_]+/gi,"-")}-analysis-report.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
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
  const architectureInsights=useMemo(()=>dependencyGraph?deriveArchitectureInsights(dependencyGraph):null,[dependencyGraph]);
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
  const staticFindings=analysis?.code_insights?.maintenance_findings||[];
  const allFindings:MaintenanceFinding[]=[...healthFindings.map((item,index)=>({id:(analysis?.project_name||"project")+":health:"+index+":"+item.title,kind:"structure",severity:item.severity,title:item.title,detail:item.detail,path:item.path,confidence:"heuristic" as const})),...staticFindings.map(item=>({...item,id:(analysis?.project_name||"project")+":"+item.id}))];
  const visibleFindings=allFindings.filter(item=>(issueFilter==="all"||(issueFilter==="resolved"?resolvedIssues.includes(item.id):!resolvedIssues.includes(item.id)))&&(findingSeverity==="all"||item.severity===findingSeverity)&&(!findingQuery.trim()||[item.title,item.detail,item.path||"",item.evidence||"",item.kind].join(" ").toLowerCase().includes(findingQuery.trim().toLowerCase())));

  const graphNodes=useMemo(()=>{if(!dependencyGraph)return[];const names=dependencyGraph.nodes.length?dependencyGraph.nodes:[...new Set(dependencyGraph.edges.flatMap(e=>[e.from,e.to]))];return names.slice(0,28).map((path,index,all)=>{const angle=2*Math.PI*index/Math.max(all.length,1)-Math.PI/2;return{path,x:400+Math.cos(angle)*(all.length>1?178:0),y:245+Math.sin(angle)*(all.length>1?178:0)};});},[dependencyGraph]);
  const graphPosition=new Map(graphNodes.map(node=>[node.path,node] as const));
  const baseline=savedSnapshots.find(snapshot=>snapshot.id===selectedBaseline&&snapshot.project_name===analysis?.project_name);
  const fileComparison=baseline&&analysis?compareSnapshotFiles(baseline.files,analysis.files):{addedFiles:[],removedFiles:[],modifiedFiles:[],comparable:false};
  const {addedFiles,removedFiles,modifiedFiles}=fileComparison;
  const modifiedFilesComparable=Boolean(baseline&&analysis&&fileComparison.comparable);
  const currentEdges=new Set(dependencyGraph?.edges.map(e=>`${e.from}→${e.to}`)||[]);const baselineEdges=new Set(baseline?.edges.map(e=>`${e.from}→${e.to}`)||[]);
  const addedEdges=[...currentEdges].filter(e=>!baselineEdges.has(e));const removedEdges=[...baselineEdges].filter(e=>!currentEdges.has(e));
  const currentSymbols=collectSymbols(analysis?.code_insights?.files);
  const baselineSymbols=collectSymbols(baseline?.analysis?.code_insights?.files);
  const currentSymbolSet=new Set(currentSymbols);
  const baselineSymbolSet=new Set(baselineSymbols);
  const addedSymbols=currentSymbols.filter(symbol=>!baselineSymbolSet.has(symbol));
  const removedSymbols=baselineSymbols.filter(symbol=>!currentSymbolSet.has(symbol));

  const statusLabel = {
    checking: "Checking API connection…",
    online: "Backend connected · API operational",
    offline: "Backend connection unavailable",
  }[apiState];
  const displayedStatusLabel=apiState==="online"&&apiVersion?.commit&&apiVersion.commit!=="unknown"?`${statusLabel} · ${apiVersion.commit.slice(0,7)}`:statusLabel;

  function toggleFolder(folder: string) {
    setCollapsedFolders((current) => current.includes(folder)
      ? current.filter((item) => item !== folder)
      : [...current, folder]);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="ORBIT home"><span className="wordmark-mark">O</span>ORBIT</a>
        <div className="topbar-tools"><span className="topbar-label">DEVELOPER INTELLIGENCE / STATIC ANALYSIS</span><button className="theme-toggle" type="button" onClick={()=>setTheme(current=>current==="dark"?"light":"dark")} aria-label={`Switch to ${theme==="dark"?"light":"dark"} mode`} title={`Switch to ${theme==="dark"?"light":"dark"} mode`}><span aria-hidden="true">{theme==="dark"?"☼":"◐"}</span><span>{theme==="dark"?"LIGHT":"DARK"}</span></button></div>
      </header>

      <section className="hero">
        <p className="eyebrow">YOUR CODEBASE, UNDERSTOOD</p>
        <h1>See the structure<br />behind your software.</h1>
        <p className="intro">Understand architecture, inspect code structure, spot maintenance risks, and track how projects evolve — without executing uploaded code.</p>
        <div className={`status status-${apiState}`} role="status" aria-live="polite"><span className="status-dot" />{displayedStatusLabel}</div>
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
        <div className="github-import"><span className="github-import-label">OR IMPORT A PUBLIC REPOSITORY</span><div className="github-import-row"><input value={githubRepo} onChange={event=>setGithubRepo(event.target.value)} onKeyDown={event=>{if(event.key==="Enter")void importGithubRepository();}} placeholder="https://github.com/owner/repository" aria-label="Public GitHub repository URL" autoComplete="url"/><button type="button" onClick={importGithubRepository} disabled={isImportingRepo||isAnalyzing||apiState!=="online"}>{isImportingRepo?"IMPORTING…":"IMPORT GITHUB"}</button></div><p>Public repositories only. Paste a repository URL and press Enter or Import. Private repositories are not accessed.</p>{recentRepositories.length>0&&<div className="recent-repositories"><div className="recent-repositories-heading"><span>RECENT IMPORTS</span><button type="button" onClick={()=>{setRecentRepositories([]);try{localStorage.removeItem("orbit-recent-repositories-v1");}catch{}}}>Clear</button></div><div className="recent-repository-list">{recentRepositories.map(item=><button type="button" key={item.owner+"/"+item.repository} onClick={()=>setGithubRepo("https://github.com/"+item.owner+"/"+item.repository)} title={"Use "+item.owner+"/"+item.repository}>{item.owner}/{item.repository}</button>)}</div></div>}</div><p className="upload-guidance">Godot tip: ZIP the project folder containing project.godot. ORBIT skips the generated .godot cache automatically. Keep the ZIP under 50 MB.</p>
        {apiState !== "online" && <p className="helper-text">The analyzer becomes available when the backend is connected.</p>}
        {error && <p className="error-message" role="alert">{error}</p>}

        {analysis && (
          <div className="results" aria-live="polite">
            <div className="results-title">
              <div><p className="eyebrow">ANALYSIS COMPLETE</p><h3>{analysis.project_name}</h3></div>
              <span className="complete-tag">INVENTORY READY</span>
            </div>

            <div className="workspace-actions"><button type="button" onClick={saveCurrentSnapshot}>Save snapshot</button><button type="button" onClick={exportReport}>Export report</button><span>Snapshots stay in this browser · up to 20 versions</span></div><nav className="workspace-nav" aria-label="Project workspace"><a href="#project-health">Health</a><a href="#project-explorer">Explorer</a><a href="#architecture-map">Architecture</a><a href="#project-issues">Issues</a><a href="#project-history">History</a></nav><section className="health-overview" id="project-health"><div className="health-score"><span className="detail-kicker">STRUCTURE HEALTH ESTIMATE</span><strong>{structureScore}<small>/100</small></strong><span>Heuristic indicator · not a quality or security grade</span></div><div className="health-summary"><h4>Project health</h4><p>Signals come from static inventory and parser output. Review findings in context; a clean scan does not prove code is correct.</p><div className="health-pills"><span>{healthFindings.filter(item=>item.severity==="medium").length} review flags</span><span>{healthFindings.filter(item=>item.severity==="info").length} observations</span></div></div></section><div className="metric-grid">
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

            <section className="explorer-panel" id="project-explorer">
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
              <section className="dependency-panel" id="architecture-map">
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
                {architectureInsights&&<div className="architecture-insights"><div className="architecture-insights-heading"><span className="detail-kicker">ARCHITECTURE SIGNALS</span><span>{architectureInsights.connectedFiles} connected files</span></div><div className="architecture-insights-grid"><div className="architecture-signal"><h5>High-connectivity files</h5>{architectureInsights.hotspots.length?architectureInsights.hotspots.slice(0,4).map(item=><button type="button" key={item.path} onClick={()=>{const file=analysis.files.find(candidate=>candidate.path===item.path);if(file){setSelectedFile(file);document.getElementById("project-explorer")?.scrollIntoView({behavior:"smooth",block:"start"});}}}><code>{item.path}</code><span><b>{item.incoming}</b> in · <b>{item.outgoing}</b> out</span></button>):<p className="symbol-empty">No resolved connections yet.</p>}</div><div className="architecture-signal"><h5>Dependency cycles <span>{architectureInsights.cycles.length}</span></h5>{architectureInsights.cycles.length?architectureInsights.cycles.slice(0,3).map((cycle,index)=><div className="cycle-candidate" key={cycle.join("|")}><strong>Cycle candidate {index+1}</strong><span>{cycle.map(path=>path.split("/").pop()).join(" ↔ ")}</span><small>{cycle.length} files in this strongly connected group · inspect imports before refactoring</small></div>):<p className="symbol-empty">No multi-file cycles detected in resolved internal imports.</p>}</div></div><p className="explorer-footnote">Connectivity is based on resolved static imports, not runtime calls. Cycle groups indicate files that can reach one another through imports; they are review signals, not necessarily defects.</p></div>}
                <div className="architecture-graph"><div className="graph-caption"><strong>Architecture overview</strong><span>Up to 28 files and 70 connections · select a node to inspect it</span></div>{graphNodes.length?<svg viewBox="0 0 800 490" role="img" aria-label="Interactive project dependency graph">
{dependencyGraph.edges.slice(0,70).map(edge=>{const from=graphPosition.get(edge.from);const to=graphPosition.get(edge.to);return from&&to?<line key={edge.from+edge.to+edge.specifier} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="graph-edge"/>:null;})}
{graphNodes.map(node=>{const file=analysis.files.find(item=>item.path===node.path);const active=selectedFile?.path===node.path;return <g key={node.path} className={`graph-node ${active?"active":""}`} role="button" tabIndex={0} aria-label={`Select ${node.path}`} onClick={()=>file&&setSelectedFile(file)} onKeyDown={event=>{if((event.key==="Enter"||event.key===" ")&&file)setSelectedFile(file);}}><circle cx={node.x} cy={node.y} r={active?9:7}/><text x={node.x} y={node.y-13} textAnchor="middle">{node.path.split("/").pop()?.slice(0,22)}</text></g>;})}
</svg>:<p className="insight-empty">No resolved internal dependency edges were found. The graph appears when ORBIT can link local imports between files.</p>}</div>
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

            <section className="issues-panel" id="project-issues"><div className="explorer-heading"><div><p className="eyebrow">ACTIONABLE REVIEW</p><h4>Findings center</h4></div><span className="explorer-count">{allFindings.length} findings · {allFindings.filter(item=>!resolvedIssues.includes(item.id)).length} open</span></div><div className="issue-toolbar"><div className="issue-filters"><button className={issueFilter==="all"?"active":""} onClick={()=>setIssueFilter("all")}>All</button><button className={issueFilter==="open"?"active":""} onClick={()=>setIssueFilter("open")}>Open</button><button className={issueFilter==="resolved"?"active":""} onClick={()=>setIssueFilter("resolved")}>Resolved</button></div><div className="finding-tools"><label className="finding-search"><span>⌕</span><input value={findingQuery} onChange={event=>setFindingQuery(event.target.value)} placeholder="Search findings…" aria-label="Search findings"/></label><select className="finding-severity-filter" value={findingSeverity} onChange={event=>setFindingSeverity(event.target.value as "all"|"medium"|"info")} aria-label="Filter findings by severity"><option value="all">All severities</option><option value="medium">Review</option><option value="info">Info</option></select></div><span>Resolution state saved in this browser</span></div><div className="finding-list">{visibleFindings.map(finding=><article className={"finding-card finding-"+finding.severity+(resolvedIssues.includes(finding.id)?" finding-resolved":"")} key={finding.id}><span className="finding-severity">{finding.severity==="medium"?"REVIEW":"INFO"}</span><div className="finding-main"><strong>{finding.title}</strong><p>{finding.detail}</p>{finding.path&&<button className="finding-path" onClick={()=>{const file=analysis.files.find(item=>item.path===finding.path);if(file){setSelectedFile(file);document.getElementById("project-explorer")?.scrollIntoView({behavior:"smooth",block:"start"});}}}>{finding.path}{finding.line?" · line "+finding.line:""} ↗</button>}{finding.evidence&&<code className="finding-evidence">{finding.evidence}</code>}{finding.locations&&<div className="finding-locations">{finding.locations.map(location=><span key={location.path+location.line}>{location.path}:{location.line}</span>)}</div>}<small className="finding-confidence">{finding.confidence==="direct"?"Direct source marker":"Heuristic candidate"} · verify before changing code</small></div><button className="resolve-button" onClick={()=>toggleIssueResolved(finding.id)}>{resolvedIssues.includes(finding.id)?"Reopen":"Resolve"}</button></article>)}{!visibleFindings.length&&<p className="insight-empty">No findings in this view.</p>}</div><p className="explorer-footnote">TODO/FIXME markers are detected in source comments, not ordinary code or string literals. Repeated-code matches are review candidates, not proof of a defect. ORBIT does not execute uploaded code or perform a security audit.</p></section>
<section className="history-panel" id="project-history">{githubHistory&&<div className="git-history-block"><div className="git-history-heading"><div><strong>Recent commits · {githubHistory.repository}</strong><span>{githubHistory.default_branch?`Branch: ${githubHistory.default_branch} · `:""}{githubHistory.commits.length} commits</span></div><button type="button" className="history-refresh" onClick={()=>{const parts=githubHistory.repository.split("/");if(parts.length===2)void loadGithubHistory(parts[0],parts[1]);}} disabled={historyLoading||apiState!=="online"}>{historyLoading?"Refreshing…":"↻ Refresh"}</button></div><div className="history-search-row"><input value={historyQuery} onChange={event=>setHistoryQuery(event.target.value)} placeholder="Filter commit messages, authors or hashes…" aria-label="Filter commit history"/>{historyQuery&&<button type="button" onClick={()=>setHistoryQuery("")}>Clear</button>}</div>{githubHistory.commits.length?githubHistory.commits.filter(commit=>[commit.message,commit.author,commit.sha].join(" ").toLowerCase().includes(historyQuery.trim().toLowerCase())).map(commit=><div className="git-commit-row" key={commit.sha}><div><strong>{commit.message||"Commit message unavailable"}</strong><small>{commit.author||"Unknown author"} · {commit.date?new Date(commit.date).toLocaleString():"Date unavailable"}</small></div><code title={commit.sha}>{commit.sha.slice(0,12)}</code>{commit.url&&<a href={commit.url} target="_blank" rel="noreferrer">View ↗</a>}</div>):<p className="insight-empty">{historyError?"Commit history could not be loaded.": "No commits are available for this repository."}</p>}{githubHistory.commits.length>0&&!githubHistory.commits.some(commit=>[commit.message,commit.author,commit.sha].join(" ").toLowerCase().includes(historyQuery.trim().toLowerCase()))&&<p className="insight-empty">No commits match “{historyQuery}”. Try another search.</p>}{historyError&&<p className="history-error" role="status">{historyError} You can retry using Refresh.</p>}</div>}{historyLoading&&!githubHistory&&<p className="insight-empty">Loading public GitHub commit history…</p>}{!githubHistory&&<div className="history-intro"><p className="eyebrow">GITHUB ACTIVITY</p><h4>Recent commits</h4><p>Import a public GitHub repository to inspect its recent commit timeline.</p></div>}<div className="explorer-heading"><div><p className="eyebrow">PROJECT HISTORY</p><h4>Snapshots & version comparison</h4></div><span className="explorer-count">{savedSnapshots.length} saved snapshots</span></div>
{savedSnapshots.length?<><div className="history-controls"><select value={selectedBaseline} onChange={event=>setSelectedBaseline(event.target.value)} aria-label="Choose a saved snapshot to compare"><option value="">Choose a previous snapshot to compare</option>{savedSnapshots.filter(snapshot=>snapshot.project_name===analysis.project_name).map(snapshot=><option key={snapshot.id} value={snapshot.id}>{new Date(snapshot.savedAt).toLocaleString()}</option>)}</select></div>
{baseline?<><div className="comparison-grid"><div><strong>{addedFiles.length}</strong><span>Added files</span></div><div><strong>{removedFiles.length}</strong><span>Removed files</span></div><div><strong>{modifiedFilesComparable?modifiedFiles.length:"—"}</strong><span>Modified files</span></div><div><strong>{addedEdges.length}</strong><span>New dependencies</span></div><div><strong>{removedEdges.length}</strong><span>Removed dependencies</span></div><div><strong>{baseline.analysis?.code_insights?addedSymbols.length:"—"}</strong><span>Added symbols</span></div><div><strong>{baseline.analysis?.code_insights?removedSymbols.length:"—"}</strong><span>Removed symbols</span></div></div><div className="comparison-details"><div><h5>Added files</h5>{addedFiles.slice(0,12).map(file=><code key={file.path}>+ {file.path}</code>)}{!addedFiles.length&&<span>None</span>}</div><div><h5>Removed files</h5>{removedFiles.slice(0,12).map(file=><code key={file.path}>− {file.path}</code>)}{!removedFiles.length&&<span>None</span>}</div><div><h5>Modified files</h5>{modifiedFiles.slice(0,12).map(file=><code key={file.path}>~ {file.path}</code>)}{!modifiedFilesComparable?<span>Fingerprint data unavailable in one or both snapshots</span>:!modifiedFiles.length?<span>None detected</span>:null}</div><div><h5>Dependency changes</h5>{addedEdges.slice(0,12).map(edge=><code key={edge}>+ {edge}</code>)}{removedEdges.slice(0,12).map(edge=><code key={edge}>− {edge}</code>)}{!addedEdges.length&&!removedEdges.length&&<span>None detected</span>}</div><div><h5>Symbol changes</h5>{addedSymbols.slice(0,12).map(symbol=><code key={symbol}>+ {symbol}</code>)}{removedSymbols.slice(0,12).map(symbol=><code key={symbol}>− {symbol}</code>)}{!addedSymbols.length&&!removedSymbols.length&&<span>{baseline?.analysis?.code_insights?"No detected symbol changes":"Symbol data unavailable in this older snapshot"}</span>}</div></div></>:<p className="insight-empty">Save this analysis and another version, then select a previous snapshot to compare structural changes.</p>}
<div className="saved-snapshot-list">{savedSnapshots.slice(0,10).map(snapshot=><div key={snapshot.id}><span><strong>{snapshot.project_name}</strong><small>{new Date(snapshot.savedAt).toLocaleString()}</small></span><span>{snapshot.summary.files_scanned.toLocaleString()} files</span><button onClick={()=>loadSnapshot(snapshot)} disabled={!snapshot.analysis}>Open workspace</button></div>)}</div></>:<p className="insight-empty">No saved versions yet. Use “Save snapshot” after analyzing a project to start tracking its structure over time.</p>}
<p className="explorer-footnote">Snapshots are stored in this browser only. They are not synced across devices or sent to GitHub. Modified-file checks need SHA-256 fingerprints from supported source files within ORBIT’s analysis limits; older snapshots or analyses without fingerprints show this metric as unavailable.</p></section><p className="safety-note">✓ {analysis.safety.note}</p>
          </div>
        )}
      </section>

      <section className="feature-grid" aria-label="ORBIT capabilities">
        <article className="feature-card"><span className="feature-number">01</span><h2>Project explorer</h2><p>Search, filter, and navigate folders and files in an interactive workspace.</p></article>
        <article className="feature-card"><span className="feature-number">02</span><h2>Language profile</h2><p>Understand which languages and file types make up a project.</p></article>
        <article className="feature-card"><span className="feature-number">03</span><h2>Code insights</h2><p>Inspect functions, classes, imports, and basic structural metrics in supported source files.</p></article>
        <article className="feature-card"><span className="feature-number">04</span><h2>Architecture & history</h2><p>Explore file relationships, save snapshots, and compare project structure over time.</p></article>
      </section>

      <footer><span>ORBIT / EARLY BUILD</span><span>Designed to inspect, never execute.</span></footer>
    </main>
  );
}

export default App;
