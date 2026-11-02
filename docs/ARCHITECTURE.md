# Architecture

## Initial deployment

Browser → Vercel-hosted React frontend → Render-hosted FastAPI backend → Supabase PostgreSQL (introduced with persistence).

## First milestone

1. Establish a reliable hosted frontend and API health endpoint.
2. Design project registration and ingestion.
3. Add safe archive inspection with strict upload limits and path validation.
4. Build deterministic file inventory and language statistics.
5. Add persistence and authentication with row-level security before storing user projects.

## Security baseline

- Never execute uploaded project code.
- Reject archive entries with absolute paths or traversal segments.
- Apply upload size, expanded-size, file-count, and processing-time limits.
- Exclude common generated directories and secret files from analysis.
- Never put database service-role credentials in the browser.
- Do not send source code to external AI services without explicit user consent.
