import { useMemo, useState } from "react";

type FileItem = { path: string };
type Edge = { from: string; to: string };
type Finding = { title: string; path?: string; severity: "medium" | "info" };
type PullRequest = { number: number; title: string; html_url: string; user?: { login?: string }; updated_at?: string; additions?: number; deletions?: number; changed_files?: number; draft?: boolean };
type ChangedFile = { filename: string; status: string; additions: number; deletions: number; changes: number };
type Props = { repository: string; files: FileItem[]; edges: Edge[]; findings: Finding[]; onSelectFile: (path: string) => void };

export default function PullRequestReview({ repository, files, edges, findings, onSelectFile }: Props) {
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [selected, setSelected] = useState<PullRequest | null>(null);
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const inventory = useMemo(() => new Set(files.map((file) => file.path)), [files]);
  const related = useMemo(() => {
    const changed = new Set(changedFiles.map((file) => file.filename));
    const dependents = new Set<string>();
    for (const edge of edges) if (changed.has(edge.to)) dependents.add(edge.from);
    const relatedFindings = findings.filter((finding) => finding.path && (changed.has(finding.path) || dependents.has(finding.path)));
    return { dependents: [...dependents], findings: relatedFindings };
  }, [changedFiles, edges, findings]);

  async function loadPullRequests() {
    if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
      setError("Import a public GitHub repository to load its pull requests.");
      return;
    }
    setLoading(true); setError("");
    try {
      const response = await fetch("https://api.github.com/repos/" + repository + "/pulls?state=open&per_page=10", { headers: { Accept: "application/vnd.github+json" } });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 403 ? "GitHub's public API rate limit was reached. Try again later." : (data?.message || "Could not load pull requests."));
      if (!Array.isArray(data)) throw new Error("GitHub returned an unexpected pull request response.");
      setPullRequests(data); setLoaded(true); setSelected(null); setChangedFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load pull requests.");
    } finally { setLoading(false); }
  }

  async function inspectPullRequest(pr: PullRequest) {
    setSelected(pr); setChangedFiles([]); setFilesLoading(true); setError("");
    try {
      const response = await fetch("https://api.github.com/repos/" + repository + "/pulls/" + pr.number + "/files?per_page=100", { headers: { Accept: "application/vnd.github+json" } });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || "Could not load the changed-file list.");
      if (!Array.isArray(data)) throw new Error("GitHub returned an unexpected changed-file response.");
      setChangedFiles(data.map((item) => ({ filename: item.filename, status: item.status, additions: item.additions || 0, deletions: item.deletions || 0, changes: item.changes || 0 })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load pull request files.");
    } finally { setFilesLoading(false); }
  }

  if (!repository) return <section className="pr-review-panel"><div className="explorer-heading"><div><p className="eyebrow">GITHUB WORKFLOW</p><h4>Pull request context</h4></div></div><p className="insight-empty">Import a public GitHub repository to inspect open pull requests alongside its current architecture.</p></section>;

  return <section className="pr-review-panel" aria-labelledby="pr-review-title">
    <div className="explorer-heading"><div><p className="eyebrow">GITHUB WORKFLOW</p><h4 id="pr-review-title">Pull request impact preview</h4></div><button type="button" className="history-refresh" onClick={loadPullRequests} disabled={loading}>{loading ? "Loading…" : loaded ? "↻ Refresh PRs" : "Load open PRs"}</button></div>
    <p className="pr-review-intro">Compare changed paths with the imported project inventory, dependency links, and existing findings. This is context for a human review—not an automated code review or merge recommendation.</p>
    {error && <p className="history-error" role="status">{error}</p>}
    {loaded && !pullRequests.length && <p className="insight-empty">No open pull requests were found.</p>}
    <div className="pr-list">{pullRequests.map((pr) => <button type="button" key={pr.number} className={"pr-row" + (selected?.number === pr.number ? " selected" : "")} onClick={() => void inspectPullRequest(pr)}><span><strong>#{pr.number} · {pr.title}</strong><small>{pr.user?.login || "Unknown author"} · {pr.changed_files ?? "—"} files · +{pr.additions ?? 0} / −{pr.deletions ?? 0}{pr.draft ? " · Draft" : ""}</small></span><b>{selected?.number === pr.number ? "Selected" : "Inspect ↗"}</b></button>)}</div>
    {selected && <div className="pr-impact">
      <div className="pr-impact-heading"><strong>PR #{selected.number}: changed-file context</strong><a href={selected.html_url} target="_blank" rel="noreferrer">Open on GitHub ↗</a></div>
      {filesLoading ? <p className="insight-empty">Loading changed files…</p> : <>
        <div className="pr-impact-metrics"><span><strong>{changedFiles.length}</strong> changed paths</span><span><strong>{changedFiles.filter((file) => inventory.has(file.filename)).length}</strong> in current inventory</span><span><strong>{related.dependents.length}</strong> mapped dependents</span><span><strong>{related.findings.length}</strong> related findings</span></div>
        <div className="pr-changed-files">{changedFiles.slice(0, 30).map((file) => <div key={file.filename}><span><code>{file.filename}</code><small>{file.status} · +{file.additions} / −{file.deletions}</small></span>{inventory.has(file.filename) ? <button type="button" onClick={() => { onSelectFile(file.filename); document.getElementById("project-explorer")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Inspect ↗</button> : <small>Not in imported inventory</small>}</div>)}</div>
        {related.findings.length > 0 && <div className="pr-related"><strong>Existing findings near this change</strong>{related.findings.slice(0, 8).map((finding, index) => <span key={finding.title + index}>{finding.title}{finding.path ? " · " + finding.path : ""}</span>)}</div>}
        <p className="explorer-footnote">Only direct dependents in the imported dependency graph are shown. The imported analysis may be on the base branch, and GitHub's changed-file list is capped at 100 files.</p>
      </>}
    </div>}
  </section>;
}
