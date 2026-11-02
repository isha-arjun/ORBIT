# Architecture

## Deployed request path

Browser → Vercel-hosted React frontend → Render-hosted FastAPI backend.

Supabase PostgreSQL is planned for a later persistence milestone. It is not currently required for ZIP analysis.

## Current milestone: inventory and static code intelligence

1. The frontend checks API health with `GET /health`.
2. A user selects a ZIP archive in the frontend.
3. The browser sends the archive as multipart form data to `POST /analyze/upload`.
4. The API validates the archive and inspects metadata in memory.
5. Supported Python, JavaScript, and TypeScript files are read in memory within per-file and per-archive source-byte limits.
6. Python is parsed with the standard-library AST. JavaScript/TypeScript declarations and imports are identified with a bounded heuristic scanner.
7. The API resolves supported imports against paths in the uploaded archive and returns a best-effort internal dependency graph.
8. The API returns project inventory, language statistics, per-file code insights, and dependency edges.
9. The frontend renders the explorer, selected-file structure, and incoming/outgoing dependency relationships.

The analyzer never extracts project files to disk or executes uploaded code. It does not use an external AI service. JavaScript/TypeScript symbol detection is heuristic; results are not compiler-grade parsing. Dependency mapping resolves only supported static imports that match files in the archive; it does not represent external packages, dynamic imports, runtime references, or every alias convention. Python complexity is a basic branch-node estimate, not a formal maintainability metric.

## Upload and analysis safeguards

- Maximum compressed upload: 15 MB.
- Maximum expanded file content: 80 MB.
- Maximum files: 2,500 (with a bounded archive-entry count).
- Maximum individual source file analyzed: 256 KB.
- Maximum total source bytes analyzed per archive: 5 MB.
- Supported source extensions: Python, JavaScript, and TypeScript variants.
- Reject absolute paths, traversal segments, malformed paths, and symbolic links.
- Ignore common generated/vendor directories.
- Omit common secret/credential filenames from analysis.

## Privacy and security baseline

The archive bytes are transmitted to the Render API and held in memory. Supported source contents are read in memory for static analysis; the application does not intentionally persist source contents. Filename filtering is not a substitute for excluding sensitive material before upload. Users should remove `.env` files, credentials, private keys, and other sensitive material before creating the ZIP.

- Never execute uploaded project code.
- Keep upload, expanded-size, file-count, per-file, and total-source limits.
- Validate archive paths before including entries in results.
- Do not send source code to external AI services without explicit user consent.
- Do not put database service-role credentials in the browser.
- Add authentication and row-level security before storing user projects.
