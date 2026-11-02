# ORBIT Backend

FastAPI service for ORBIT.

## Render configuration

- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health-check path: `/health`

The initial service only exposes a health endpoint. Code ingestion and analysis will be added in later milestones. Uploaded project files must be treated as untrusted data and must never be executed.
