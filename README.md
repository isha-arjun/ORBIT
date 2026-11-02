# ORBIT

ORBIT is a cloud-hosted developer intelligence platform. It creates a structural inventory of source projects and performs bounded static analysis of supported source files from ZIP archives.

## Architecture

- `frontend/`: React + TypeScript + Vite, deployed to Vercel.
- `backend/`: Python + FastAPI, deployed to Render.
- `docs/`: architecture and development notes.
- Supabase PostgreSQL is planned for a later persistence milestone and is not currently part of the request path.

## Current features

The frontend sends a ZIP archive to `POST /analyze/upload`. The API returns project counts, language statistics, folder and file inventory, plus static code insights for Python, JavaScript, and TypeScript: detected functions, classes, imports, line counts, and a basic Python branch-count estimate.

Python files use the standard-library AST parser. JavaScript and TypeScript use a lightweight structural scan; symbol detection is heuristic and is not a full compiler, type checker, dependency resolver, or security audit.

## Upload and analysis limits

- Maximum compressed upload: 15 MB.
- Maximum expanded file content: 80 MB.
- Maximum files: 2,500.
- Maximum individual source file analyzed: 256 KB.
- Maximum total source bytes analyzed per archive: 5 MB.
- Supported source extensions: Python, JavaScript, and TypeScript variants.
- Unsafe paths and symbolic links are rejected; common generated folders are excluded.

## Privacy and safety

The ZIP is transmitted to the ORBIT API on Render. Supported source files are read in memory for static analysis; the application does not intentionally persist source contents. Remove `.env` files, credentials, tokens, private keys, and other sensitive material before creating the ZIP. Filename filtering does not prevent other secrets from being transmitted.

ORBIT never executes uploaded project code and does not send source code to third-party AI services.
