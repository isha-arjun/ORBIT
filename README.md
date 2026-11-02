# ORBIT

ORBIT is a cloud-hosted developer intelligence platform. Its first milestone is to inspect a source-code project and produce a safe, useful structural analysis.

## Architecture

- `frontend/`: React + TypeScript + Vite, deployed to Vercel.
- `backend/`: Python + FastAPI, deployed to Render.
- `docs/`: architecture and development notes.
- Supabase PostgreSQL will be added when persistence is implemented.

## Initial status

This is the initial repository scaffold. The frontend and backend will begin with minimal running shells. Project upload and code analysis are not implemented yet.

## Safety principles

ORBIT must inspect source files as data, never execute uploaded project code, enforce upload and archive limits, reject unsafe archive paths, and avoid transmitting source code to third-party services without clear user consent.
