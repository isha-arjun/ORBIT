# Architecture

## Deployed request path

Browser → Vercel-hosted React frontend → Render-hosted FastAPI backend.

Supabase PostgreSQL is planned for a later persistence milestone. It is not currently required for ZIP inventory analysis.

## Current milestone: ZIP project inventory

1. The frontend checks API health with `GET /health`.
2. A user selects a ZIP archive in the frontend.
3. The browser sends the archive as multipart form data to `POST /analyze/upload`.
4. The API validates the archive and inspects its metadata in memory.
5. The API returns project-level counts, language statistics, folders, and a file inventory.
6. The frontend renders the results.

The analyzer does not extract the archive to disk, execute project code, or read source-file contents. It is a structural inventory only; AST analysis, dependency mapping, code metrics, persistence, and authentication are future work.

## Archive safeguards

- Maximum compressed upload: 15 MB.
- Maximum expanded file content: 80 MB.
- Maximum files: 2,500 (with a bounded archive-entry count).
- Reject absolute paths, traversal segments, malformed paths, and symbolic links.
- Ignore common generated/vendor directories in the returned inventory.
- Omit common secret/credential filenames from the returned inventory.

The archive bytes are still transmitted to the Render API and held in memory during inspection. Filename filtering is not a substitute for excluding secrets before upload. The frontend should clearly warn users not to upload `.env` files, credentials, private keys, or other sensitive material.

## Security baseline

- Never execute uploaded project code.
- Keep upload, expanded-size, file-count, and archive-entry limits.
- Validate archive paths before including entries in results.
- Do not send source code to external AI services without explicit user consent.
- Do not put database service-role credentials in the browser.
- Add authentication and row-level security before storing user projects.
