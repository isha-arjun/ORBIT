from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="ORBIT API",
    description="Developer intelligence API",
    version="0.1.0",
)

# Restrict this to the deployed frontend origin before production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check() -> dict[str, str]:
    """Return a small health response for hosting-provider checks."""
    return {"status": "ok", "service": "orbit-api"}
