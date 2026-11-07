import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { buildDeveloperActions, rankCodebaseMatches } from "./developerGuide.mjs";

type GuideFile = { path: string; name: string; language: string };
type GuideInsight = { path: string; status: string; functions?: { name: string }[]; classes?: { name: string }[]; signals?: { name: string }[]; imports?: string[]; complexity_estimate?: number | null };
type GuideFinding = { title: string; detail: string; severity: "medium" | "info"; path?: string; evidence?: string };
type Props = {
  files: GuideFile[];
  insights: GuideInsight[];
  findings: GuideFinding[];
  edges?: { from: string; to: string }[];
  onSelectFile: (path: string) => void;
};

export default function DeveloperCompanion({ files, insights, findings, edges = [], onSelectFile }: Props) {
  const [query, setQuery] = useState("");
  const [answerQuery, setAnswerQuery] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const actions = useMemo(() => buildDeveloperActions(files, insights, findings, { edges }), [files, insights, findings, edges]);
  const matches = useMemo(() => rankCodebaseMatches(query, files, insights, findings), [query, files, insights, findings]);
  const answers = useMemo(() => rankCodebaseMatches(answerQuery, files, insights, findings), [answerQuery, files, insights, findings]);
  const paletteItems = useMemo(() => (query.trim() ? matches : files.slice(0, 8).map(file => ({ path: file.path, language: file.language, reasons: ["Project file"], findingCount: 0 }))).slice(0, 8), [query, matches, files]);
  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (paletteOpen) inputRef.current?.focus();
  }, [paletteOpen]);

  function select(path: string) {
    onSelectFile(path);
    setPaletteOpen(false);
    document.getElementById("project-explorer")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handlePaletteKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex(index => Math.min(index + 1, Math.max(0, paletteItems.length - 1))); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex(index => Math.max(0, index - 1)); }
    if (event.key === "Enter" && paletteItems[activeIndex]) { event.preventDefault(); select(paletteItems[activeIndex].path); }
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(answerQuery);
  }

  return (
    <section className="developer-companion" aria-labelledby="developer-companion-title">
      <div className="companion-heading">
        <div>
          <p className="eyebrow">YOUR NEXT MOVE</p>
          <h4 id="developer-companion-title">A useful place to start</h4>
          <p>ORBIT has mapped the project. Here are evidence-backed places worth exploring next.</p>
        </div>
        <button type="button" className="command-trigger" onClick={() => setPaletteOpen(true)}><span>⌘ K</span> Find anything</button>
      </div>
      <div className="companion-actions">
        {actions.map((action, index) => (
          <article className="companion-action" key={action.id}>
            <span className="companion-action-number">0{index + 1}</span>
            <div><strong>{action.title}</strong><p>{action.detail}</p></div>
            {action.path ? <button type="button" onClick={() => select(action.path!)}>Inspect ↗</button> : <button type="button" onClick={() => document.getElementById(action.target || "project-issues")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Open ↗</button>}
          </article>
        ))}
      </div>
      <form className="companion-query" onSubmit={submitQuestion}>
        <label htmlFor="orbit-guide-query">Find a file, symbol, import, or issue</label>
        <div><span aria-hidden="true">⌕</span><input id="orbit-guide-query" value={answerQuery} onChange={(event) => setAnswerQuery(event.target.value)} placeholder="Try “authentication”, “routes”, or a function name" /><button type="submit" disabled={!answerQuery.trim()}>Search project</button></div>
        <p>Search uses analyzed paths, detected symbols, imports, and findings. It does not send your code anywhere.</p>
        {answerQuery.trim() && <div className="companion-results" aria-live="polite">{answers.length ? answers.slice(0, 5).map(item => <button type="button" key={item.path} onClick={() => select(item.path)}><span><code>{item.path}</code><small>{item.reasons.join(" · ") || item.language}</small></span><b>{item.findingCount ? item.findingCount + " finding(s)" : item.language}</b></button>) : <p>No indexed matches yet. Try a file name, language, detected symbol, or import path.</p>}</div>}
      </form>
      {paletteOpen && <div className="command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }}>
        <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title">
          <div className="command-palette-title"><strong id="command-palette-title">Jump to a file</strong><button type="button" onClick={() => setPaletteOpen(false)} aria-label="Close command palette">Esc</button></div>
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handlePaletteKeyDown} placeholder="Type a path, language, symbol, or import…" aria-label="Search project files" aria-controls="orbit-command-results" aria-activedescendant={paletteItems[activeIndex] ? "orbit-command-option-" + activeIndex : undefined} />
          <div className="command-results" id="orbit-command-results" role="listbox">{paletteItems.map((item, index) => <button type="button" role="option" aria-selected={activeIndex === index} id={"orbit-command-option-" + index} key={item.path} onMouseEnter={() => setActiveIndex(index)} onClick={() => select(item.path)}><span><code>{item.path}</code><small>{item.reasons.join(" · ")}</small></span><b>{item.language}</b></button>)}
            {query.trim() && !matches.length && <p>No matching files. Try a shorter term or a symbol name.</p>}
          </div>
          <div className="command-hint">↑ / ↓ Move · Enter to open · Esc to close</div>
        </section>
      </div>}
    </section>
  );
}
