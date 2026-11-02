from collections import Counter
from io import BytesIO
from pathlib import PurePosixPath
import ast
import re
import stat
import zipfile

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="ORBIT API", description="Developer intelligence API", version="0.3.0")
FRONTEND_ORIGINS = ["https://orbit-clear-board.vercel.app", "https://orbit-jade-rho.vercel.app"]
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_FILES = 2500
MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024
MAX_SOURCE_FILE_BYTES = 256 * 1024
MAX_SOURCE_ANALYSIS_BYTES = 5 * 1024 * 1024
IGNORED_DIRECTORIES = {".git", "node_modules", ".venv", "venv", "__pycache__", ".next", "dist", "build", ".turbo", ".cache"}
SENSITIVE_NAMES = {".env", ".env.local", ".env.production", ".env.development", "id_rsa", "id_ed25519"}
LANGUAGES = {
    ".py": "Python", ".pyi": "Python", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
    ".ts": "TypeScript", ".tsx": "TypeScript", ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin", ".swift": "Swift",
    ".go": "Go", ".rs": "Rust", ".c": "C", ".h": "C/C++", ".cpp": "C++", ".cc": "C++", ".hpp": "C++",
    ".cs": "C#", ".php": "PHP", ".rb": "Ruby", ".lua": "Lua", ".dart": "Dart", ".html": "HTML", ".htm": "HTML",
    ".css": "CSS", ".scss": "SCSS", ".sass": "SCSS", ".less": "Less", ".json": "JSON", ".md": "Markdown", ".mdx": "MDX",
    ".yaml": "YAML", ".yml": "YAML", ".toml": "TOML", ".xml": "XML", ".sql": "SQL", ".sh": "Shell", ".bash": "Shell",
    ".zsh": "Shell", ".ps1": "PowerShell", ".ipynb": "Jupyter Notebook", ".vue": "Vue", ".svelte": "Svelte",
}
SOURCE_EXTENSIONS = {".py", ".pyi", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"}

app.add_middleware(CORSMiddleware, allow_origins=FRONTEND_ORIGINS, allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["*"])

@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "orbit-api"}

def _safe_archive_path(raw_name: str) -> PurePosixPath:
    if not raw_name or "\x00" in raw_name or "\\" in raw_name:
        raise ValueError("The ZIP contains an invalid file path.")
    path = PurePosixPath(raw_name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError("The ZIP contains an unsafe file path.")
    if path.parts and re.match(r"^[a-zA-Z]:", path.parts[0]):
        raise ValueError("The ZIP contains an unsafe file path.")
    if len(raw_name) > 500:
        raise ValueError("The ZIP contains a file path that is too long.")
    return path

def _language_for(path: PurePosixPath) -> str:
    name = path.name.lower()
    if name == "dockerfile" or name.startswith("dockerfile."):
        return "Dockerfile"
    if name in {"makefile", "gnumakefile"}:
        return "Make"
    return LANGUAGES.get(path.suffix.lower(), "Other")

def _python_insights(source: str) -> dict:
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return {"status": "parse_error", "error": f"Python syntax error on line {exc.lineno or '?'}"}
    functions, classes, imports = [], [], []
    branch_nodes = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.With, ast.AsyncWith, ast.ExceptHandler, ast.IfExp, ast.Match, ast.Assert)
    complexity = 1
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            functions.append({"name": node.name, "line": node.lineno, "kind": "async" if isinstance(node, ast.AsyncFunctionDef) else "function"})
        elif isinstance(node, ast.ClassDef):
            classes.append({"name": node.name, "line": node.lineno})
        elif isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append("." * (node.level or 0) + (node.module or ""))
        if isinstance(node, branch_nodes):
            complexity += 1
    return {"status": "analyzed", "functions": functions, "classes": classes, "imports": sorted(set(x for x in imports if x)), "lines": len(source.splitlines()), "complexity_estimate": complexity, "parser": "Python AST"}

def _javascript_insights(source: str) -> dict:
    mask_pattern = r"(?s)/\*.*?\*/|//[^\n]*|\x60(?:\\.|[^\x60])*\x60|'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\""
    masked = re.sub(mask_pattern, lambda m: re.sub(r"[^\n]", " ", m.group(0)), source)
    functions, seen = [], set()
    patterns = [
        (r"\b(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)\s*\(", "function"),
        (r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>", "arrow"),
        (r"\b(?:get|set|async)?\s*([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*\{", "method"),
    ]
    for pattern, kind in patterns:
        for match in re.finditer(pattern, masked):
            key = (match.group(1), match.start())
            if key not in seen:
                seen.add(key)
                functions.append({"name": key[0], "line": source.count("\n", 0, match.start()) + 1, "kind": kind})
    classes = [{"name": m.group(1), "line": source.count("\n", 0, m.start()) + 1} for m in re.finditer(r"\bclass\s+([A-Za-z_$][\w$]*)", masked)]
    imports = []
    for match in re.finditer(r"\bimport\s+(?:[^;\n]*?\s+from\s+)?['\"]([^'\"]+)['\"]|\brequire\s*\(\s*['\"]([^'\"]+)['\"]\s*\)", source):
        imports.append(match.group(1) or match.group(2))
    return {"status": "analyzed", "functions": functions, "classes": classes, "imports": sorted(set(imports)), "lines": len(source.splitlines()), "complexity_estimate": None, "parser": "JavaScript/TypeScript structural scan"}

def _analyze_source(path: PurePosixPath, raw: bytes) -> dict:
    try:
        source = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return {"status": "skipped_binary", "reason": "File is not valid UTF-8 text."}
    if "\x00" in source:
        return {"status": "skipped_binary", "reason": "File appears to contain binary data."}
    if path.suffix.lower() in {".py", ".pyi"}:
        return _python_insights(source)
    return _javascript_insights(source)

@app.post("/analyze/upload")
async def analyze_upload(file: UploadFile = File(...)) -> dict:
    filename = file.filename or "project.zip"
    if not filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Please upload a .zip file.")
    payload = await file.read(MAX_UPLOAD_BYTES + 1)
    await file.close()
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="ZIP is too large. The upload limit is 15 MB.")
    try:
        archive = zipfile.ZipFile(BytesIO(payload))
    except (zipfile.BadZipFile, OSError):
        raise HTTPException(status_code=400, detail="That file is not a valid ZIP archive.")
    try:
        entries = archive.infolist()
        if len(entries) > MAX_FILES + 500:
            raise HTTPException(status_code=413, detail="The ZIP contains too many entries.")
        file_rows, folder_paths = [], set()
        language_counts = Counter()
        total_uncompressed, source_budget = 0, MAX_SOURCE_ANALYSIS_BYTES
        source_rows, seen_paths = [], set()
        for entry in entries:
            try:
                path = _safe_archive_path(entry.filename.rstrip("/"))
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise HTTPException(status_code=400, detail="The ZIP contains a symbolic link.")
            if any(part in IGNORED_DIRECTORIES for part in path.parts):
                continue
            if path.name in SENSITIVE_NAMES or path.name.endswith((".pem", ".key", ".p12")):
                continue
            if entry.is_dir():
                folder_paths.add(path.as_posix())
                continue
            normalized = path.as_posix()
            if normalized in seen_paths:
                continue
            seen_paths.add(normalized)
            total_uncompressed += entry.file_size
            if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
                raise HTTPException(status_code=413, detail="The ZIP expands beyond the 80 MB analysis limit.")
            if len(file_rows) >= MAX_FILES:
                raise HTTPException(status_code=413, detail="The project contains more than 2,500 files.")
            for parent in path.parents:
                if parent.as_posix() != ".":
                    folder_paths.add(parent.as_posix())
            language = _language_for(path)
            language_counts[language] += 1
            file_rows.append({"path": normalized, "name": path.name, "extension": path.suffix.lower() or "(none)", "language": language, "size_bytes": entry.file_size})
            if path.suffix.lower() in SOURCE_EXTENSIONS and entry.file_size <= MAX_SOURCE_FILE_BYTES and entry.file_size <= source_budget:
                with archive.open(entry, "r") as source_file:
                    raw = source_file.read(MAX_SOURCE_FILE_BYTES + 1)
                if len(raw) <= MAX_SOURCE_FILE_BYTES:
                    source_rows.append((normalized, path, raw))
                    source_budget -= len(raw)
        if not file_rows:
            raise HTTPException(status_code=400, detail="No analyzable files were found in that ZIP.")
        file_rows.sort(key=lambda item: item["path"].lower())
        languages = [{"name": name, "files": count} for name, count in language_counts.most_common()]
        totals, code_insights = Counter(), []
        for normalized, path, raw in source_rows:
            insight = _analyze_source(path, raw)
            insight["path"] = normalized
            code_insights.append(insight)
            if insight.get("status") == "analyzed":
                totals["files_analyzed"] += 1
                totals["functions"] += len(insight.get("functions", []))
                totals["classes"] += len(insight.get("classes", []))
                totals["imports"] += len(insight.get("imports", []))
        code_insights.sort(key=lambda item: item["path"].lower())
        supported_count = sum(1 for row in file_rows if row["extension"] in SOURCE_EXTENSIONS)
        return {
            "project_name": PurePosixPath(filename).stem[:80] or "Project",
            "summary": {"files_scanned": len(file_rows), "folders_found": len(folder_paths), "total_uncompressed_bytes": total_uncompressed, "languages_detected": len(language_counts)},
            "languages": languages,
            "folders": sorted(folder_paths, key=str.lower),
            "files": file_rows,
            "code_insights": {
                "summary": {"files_analyzed": totals["files_analyzed"], "functions_found": totals["functions"], "classes_found": totals["classes"], "imports_found": totals["imports"], "source_files_skipped_or_over_limit": max(0, supported_count - len(code_insights))},
                "files": code_insights,
                "supported_languages": ["Python", "JavaScript", "TypeScript"],
                "limits": {"max_source_file_bytes": MAX_SOURCE_FILE_BYTES, "max_total_source_bytes": MAX_SOURCE_ANALYSIS_BYTES},
            },
            "safety": {"source_executed": False, "source_contents_read": True, "analysis_mode": "static", "note": "ORBIT read supported source files in memory for static structure analysis. It did not execute code or intentionally store source contents."},
        }
    finally:
        archive.close()
