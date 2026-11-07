# ORBIT

ORBIT is a cloud-hosted developer intelligence workspace. It creates a structural inventory of source projects and performs bounded static analysis of supported source files from ZIP archives or public GitHub repositories.

## Architecture

- `frontend/`: React + TypeScript + Vite, deployed to Vercel.
- `backend/`: Python + FastAPI, deployed to Render.
- Supabase persistence is not currently part of the request path. Saved analysis snapshots are stored locally in the browser.

## Current features

- ZIP upload and public GitHub repository import.
- Project inventory, language profile, folder explorer, and symbol/import search.
- Static code insights for Python, JavaScript, TypeScript, and GDScript where supported by the backend.
- Best-effort internal dependency graph and interactive architecture visualization.
- Architecture signals derived from resolved imports: high-connectivity files and strongly connected dependency groups (cycle candidates), with direct navigation to affected files.
- Findings center with TODO/FIXME/HACK markers found in source comments, repeated-code candidates, parser errors, skipped files, unresolved imports, complexity estimates, and large-file signals. Function reachability is not guessed from name occurrence counts because framework routes and dynamic calls make that unreliable.
- Finding triage with open/resolved states stored in the current browser, plus text search and severity filters.
- Recent public GitHub commit history via the repository's Atom feed, avoiding the unauthenticated GitHub REST API quota, with in-workspace search and manual refresh.
- Up to five recently imported public repositories remembered locally for quick re-entry.
- Local project snapshots and comparisons of added/removed files, modified source files (using SHA-256 fingerprints, not retained source text), dependency edges, and detected functions/classes/signals; up to 20 snapshots are retained in the current browser.
- Snapshot change-impact review: traces direct and transitive dependents of changed files using the union of baseline and current dependency edges, then surfaces findings attached to changed or connected files. This is a static review estimate, not a regression prediction; incomplete fingerprints can make modified-file impact incomplete.
- Guided developer companion that recommends next actions from parser output, review-level findings, and dependency metadata; suggestions remain traceable to the underlying evidence.
- Project search across file paths, detected functions/classes/signals, imports, and finding text, plus a keyboard command palette (`Cmd/Ctrl+K`) for jumping directly to files.
- Public GitHub pull request impact preview: lists open PRs, compares changed paths with the imported inventory, and surfaces direct mapped dependents and existing findings near changed files. It is context for human review, not automated code review.
- Downloadable versioned JSON analysis reports containing project inventory, health indicators, code insights, dependency graph data, findings with local resolution states, and (when selected) snapshot diffs plus change-impact estimates.

## Analysis limits

- Maximum compressed upload: 50 MB.
- Maximum expanded file content: 150 MB.
- Maximum files: 2,500.
- Maximum individual source file analyzed: 256 KB.
- Maximum total source bytes analyzed per archive: 5 MB.
- Unsafe paths and symbolic links are rejected; common generated folders are excluded.
- GitHub import currently supports public repositories only and imports the repository's default branch. Recent commit history and pull request metadata are fetched separately from the public GitHub API; unauthenticated API rate limits may apply. Pull request impact preview compares changed paths against the currently imported inventory, so import the PR's base branch for the most useful context. GitHub's changed-file endpoint is capped at 100 files.

Python files use the standard-library AST parser. JavaScript and TypeScript use a lightweight structural scan; symbol detection is heuristic and is not a full compiler, type checker, or security audit. The developer companion searches the analyzed metadata (paths, detected symbols, imports, and findings); it is not an AI code-understanding model and does not infer behavior from source text. The dependency map is best-effort: external packages, dynamic imports, runtime references, and unresolved aliases are not represented. Repeated code blocks are heuristic candidates, not proof of defects. ORBIT deliberately does not label functions unused based only on textual name counts; dynamic calls, framework hooks, reflection, and external entry points make that inference unreliable. TODO-style markers are detected from actual comments rather than ordinary code or string literals.

## Privacy and safety

The ZIP is transmitted to the ORBIT API on Render. Supported source files are read in memory for static analysis; the application does not intentionally persist source contents. For eligible supported source files, ORBIT returns a SHA-256 content fingerprint to enable local snapshot change detection; the fingerprint is not source text and is not used to reconstruct files. Remove credentials, tokens, private keys, and other sensitive material before creating the ZIP. Public GitHub archives are fetched server-side by the analyzer API; recent commit metadata is fetched from GitHub for the timeline. ORBIT never executes uploaded project code and does not send source code to third-party AI services.

Saved snapshots are stored in the current browser's local storage. They are not cloud-synced and may be cleared when browser site data is removed.

## Development checks

Run the backend regression suite from the repository root:

```bash
python -m pip install -r backend/requirements.txt
python -m unittest discover -s backend/tests -v
```

Build and type-check the frontend:

```bash
cd frontend
npm install
npm test
npm run build
```

GitHub Actions runs the backend regression suite, frontend unit tests, and frontend production build for pushes to `main` and pull requests targeting `main`.
