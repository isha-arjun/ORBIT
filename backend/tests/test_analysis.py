import unittest
from pathlib import PurePosixPath

from backend.app.main import (
    _analyze_source,
    _build_dependency_graph,
    _comment_lines,
    _gdscript_insights,
    _javascript_insights,
    _language_for,
    _project_maintenance_findings,
    _python_insights,
    _resolve_js_dependency,
    _safe_archive_path,
)


class ArchivePathTests(unittest.TestCase):
    def test_accepts_normal_relative_path(self):
        self.assertEqual(_safe_archive_path("src/main.py"), PurePosixPath("src/main.py"))

    def test_rejects_unsafe_paths(self):
        for path in ("", "../secret.txt", "/absolute.txt", "C:/secret.txt", "folder\\file.py", "bad\x00name"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                _safe_archive_path(path)


class LanguageAndParserTests(unittest.TestCase):
    def test_language_detection(self):
        self.assertEqual(_language_for(PurePosixPath("Dockerfile")), "Dockerfile")
        self.assertEqual(_language_for(PurePosixPath("src/main.py")), "Python")
        self.assertEqual(_language_for(PurePosixPath("data.unknown")), "Other")

    def test_python_ast_extracts_symbols_and_imports(self):
        result = _python_insights(
            "import json\nfrom pathlib import Path\n"
            "class Worker:\n    pass\n"
            "async def run_job():\n    if True:\n        return Path('x')\n"
        )
        self.assertEqual(result["status"], "analyzed")
        self.assertEqual([item["name"] for item in result["classes"]], ["Worker"])
        self.assertIn("run_job", [item["name"] for item in result["functions"]])
        self.assertEqual(result["imports"], ["json", "pathlib"])

    def test_python_syntax_error_is_reported_without_crashing(self):
        result = _python_insights("def broken(:\n    pass")
        self.assertEqual(result["status"], "parse_error")
        self.assertIn("line 1", result["error"])

    def test_javascript_scanner_ignores_function_text_in_comments_and_strings(self):
        source = (
            "// function commentedOut() {}\n"
            "const example = 'function insideString() {}';\n"
            "export async function loadProject() { return true; }\n"
            "class ProjectStore {}\n"
            "import React from 'react';"
        )
        result = _javascript_insights(source)
        names = [item["name"] for item in result["functions"]]
        self.assertIn("loadProject", names)
        self.assertNotIn("commentedOut", names)
        self.assertNotIn("insideString", names)
        self.assertEqual([item["name"] for item in result["classes"]], ["ProjectStore"])
        self.assertEqual(result["imports"], ["react"])

    def test_gdscript_scanner_finds_functions_signals_and_resources(self):
        result = _gdscript_insights(
            'extends Node\nsignal completed\nclass_name Runner\n'
            'func start():\n    var scene = preload("res://levels/one.tscn")\n'
        )
        self.assertEqual(result["status"], "analyzed")
        self.assertIn("start", [item["name"] for item in result["functions"]])
        self.assertIn("Runner", [item["name"] for item in result["classes"]])
        self.assertIn("completed", [item["name"] for item in result["signals"]])
        self.assertIn("res://levels/one.tscn", result["imports"])

    def test_binary_source_is_skipped(self):
        result = _analyze_source(PurePosixPath("main.py"), b"\xff\xfe\x00")
        self.assertEqual(result["status"], "skipped_binary")


class DependencyAndFindingTests(unittest.TestCase):
    def test_relative_javascript_dependency_resolution(self):
        known = {"src/App.tsx", "src/main.tsx", "src/styles.css"}
        self.assertEqual(_resolve_js_dependency("src/main.tsx", "./App", known), "src/App.tsx")
        self.assertIsNone(_resolve_js_dependency("src/main.tsx", "../outside", known))

    def test_dependency_graph_counts_internal_edges(self):
        insights = [
            {"path": "src/main.tsx", "status": "analyzed", "imports": ["./App"]},
            {"path": "src/App.tsx", "status": "analyzed", "imports": []},
        ]
        files = [{"path": "src/main.tsx"}, {"path": "src/App.tsx"}]
        graph = _build_dependency_graph(insights, files)
        self.assertEqual(graph["summary"]["internal_dependencies"], 1)
        self.assertEqual(graph["edges"][0]["to"], "src/App.tsx")

    def test_todo_in_comments_is_found_but_string_marker_is_ignored(self):
        source = b'# TODO: finish this\nmessage = "TODO: just an example"\n'
        rows = [("main.py", PurePosixPath("main.py"), source)]
        findings = _project_maintenance_findings(rows, [])
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["title"], "TODO marker")
        self.assertEqual(findings[0]["line"], 1)

    def test_python_comment_scanner_ignores_string_literals(self):
        comments = _comment_lines("sample.py", 'text = "# TODO: not a comment"\n# FIXME: real issue')
        self.assertEqual(len(comments), 1)
        self.assertIn("FIXME", comments[0][1])


if __name__ == "__main__":
    unittest.main()
