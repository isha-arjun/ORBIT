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
- Explainable structural maintenance signals: parse failures, skipped files, unresolved relative imports, high branch-count estimates, and large files.
- Local project snapshots and comparisons of added/removed files and dependency edges.
- Downloadable JSON analysis reports.

## Analysis limits

- Maximum compressed upload: 50 MB.
- Maximum expanded file content: 150 MB.
- Maximum files: 2,500.
- Maximum individual source file analyzed: 256 KB.
- Maximum total source bytes analyzed per archive: 5 MB.
- Unsafe paths and symbolic links are rejected; common generated folders are excluded.
- GitHub import currently supports public repositories only and imports the repository's default branch.

Python files use the standard-library AST parser. JavaScript and TypeScript use a lightweight structural scan; symbol detection is heuristic and is not a full compiler, type checker, or security audit. The dependency map is best-effort: external packages, dynamic imports, runtime references, and unresolved aliases are not represented.

## Privacy and safety

The ZIP is transmitted to the ORBIT API on Render. Supported source files are read in memory for static analysis; the application does not intentionally persist source contents. Remove credentials, tokens, private keys, and other sensitive material before creating the ZIP. Public GitHub archives are fetched directly by the browser and sent to the analyzer API. ORBIT never executes uploaded project code and does not send source code to third-party AI services.

Saved snapshots are stored in the current browser's local storage. They are not cloud-synced and may be cleared when browser site data is removed.
