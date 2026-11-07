import test from "node:test";
import assert from "node:assert/strict";
import { compareSnapshotFiles } from "./snapshotComparison.mjs";

const file = (path, extension, content_sha256) => ({
  path,
  extension,
  ...(content_sha256 ? { content_sha256 } : {}),
});

test("detects a modified source file by its fingerprint", () => {
  const result = compareSnapshotFiles(
    [file("src/main.py", ".py", "a".repeat(64))],
    [file("src/main.py", ".py", "b".repeat(64))],
  );
  assert.deepEqual(result.modifiedFiles.map((item) => item.path), ["src/main.py"]);
  assert.equal(result.comparable, true);
});

test("does not report unchanged source files as modified", () => {
  const hash = "c".repeat(64);
  const result = compareSnapshotFiles(
    [file("src/main.ts", ".ts", hash)],
    [file("src/main.ts", ".ts", hash)],
  );
  assert.deepEqual(result.modifiedFiles, []);
  assert.equal(result.comparable, true);
});

test("separates added and removed files from modified files", () => {
  const result = compareSnapshotFiles(
    [file("src/old.js", ".js", "a".repeat(64)), file("README.md", ".md")],
    [file("src/new.js", ".js", "b".repeat(64)), file("README.md", ".md")],
  );
  assert.deepEqual(result.addedFiles.map((item) => item.path), ["src/new.js"]);
  assert.deepEqual(result.removedFiles.map((item) => item.path), ["src/old.js"]);
  assert.deepEqual(result.modifiedFiles, []);
  assert.equal(result.comparable, true);
});

test("marks shared source comparison unavailable if either fingerprint is missing", () => {
  const result = compareSnapshotFiles(
    [file("src/app.tsx", ".tsx")],
    [file("src/app.tsx", ".tsx", "d".repeat(64))],
  );
  assert.equal(result.comparable, false);
  assert.deepEqual(result.modifiedFiles, []);
});

test("non-source files do not invalidate source fingerprint coverage", () => {
  const hash = "e".repeat(64);
  const result = compareSnapshotFiles(
    [file("src/app.tsx", ".tsx", hash), file("assets/logo.png", ".png")],
    [file("src/app.tsx", ".tsx", hash), file("assets/logo.png", ".png")],
  );
  assert.equal(result.comparable, true);
  assert.deepEqual(result.modifiedFiles, []);
});

test("handles snapshots with no shared source files", () => {
  const result = compareSnapshotFiles(
    [file("src/old.py", ".py", "f".repeat(64))],
    [file("src/new.py", ".py", "0".repeat(64))],
  );
  assert.equal(result.comparable, true);
  assert.deepEqual(result.modifiedFiles, []);
});
