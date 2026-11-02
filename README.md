# ORBIT

ORBIT is a cloud-hosted developer intelligence platform. Its first working feature creates a structural inventory of a source-code project from a ZIP archive.

## Architecture

- `frontend/`: React + TypeScript + Vite, deployed to Vercel.
- `backend/`: Python + FastAPI, deployed to Render.
- `docs/`: architecture and development notes.
- Supabase PostgreSQL is planned for a later persistence milestone and is not currently part of the request path.

## Current feature: ZIP project inventory

The frontend sends a ZIP archive to `POST /analyze/upload`. The API returns:

- Project name and total file/folder counts.
- Expanded project size and detected language counts.
- A folder overview and file inventory, including paths, extensions, and file sizes.

The current analyzer is metadata-based. It does not yet parse source code, map dependencies, calculate code complexity, or use AI.

### Upload limits and filtering

- Maximum compressed upload: 15 MB.
- Maximum expanded file content: 80 MB.
- Maximum files: 2,500.
- Unsafe paths and symbolic links are rejected.
- Common generated folders (such as `.git`, `node_modules`, and build outputs) are excluded from the inventory.
- Common secret/credential filenames are excluded from the returned inventory.

**Privacy note:** The ZIP is transmitted to the ORBIT API on Render for in-memory inspection. Do not upload archives containing `.env` files, passwords, API tokens, private keys, or other secrets. Excluding these files before creating the ZIP is safer; filtering them from the result does not prevent their bytes from being uploaded.

## Safety principles

ORBIT treats uploaded project code as data and never executes it. It applies archive and upload limits, validates paths, and does not send source code to third-party AI services.
