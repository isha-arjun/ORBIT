import test from "node:test";
import assert from "node:assert/strict";
import { analyzeChangeImpact } from "./changeImpact.mjs";

const edge = (from, to) => ({ from, to, specifier: "./dependency" });
const finding = (id, path) => ({ id, path });

test("finds direct dependents by reversing importer-to-dependency edges", () => {
  const result = analyzeChangeImpact({
    modifiedFiles: ["src/core.ts"],
    currentEdges: [edge("src/page.ts", "src/core.ts")],
  });
  assert.deepEqual(result.impactedFiles, [
    { path: "src/page.ts", depth: 1, relation: "direct" },
  ]);
  assert.equal(result.directCount, 1);
});

test("walks transitive dependents without including changed files", () => {
  const result = analyzeChangeImpact({
    modifiedFiles: ["src/core.ts"],
    currentEdges: [
      edge("src/page.ts", "src/core.ts"),
      edge("src/app.ts", "src/page.ts"),
    ],
  });
  assert.deepEqual(result.impactedFiles.map((item) => [item.path, item.depth]), [
    ["src/page.ts", 1],
    ["src/app.ts", 2],
  ]);
  assert.equal(result.transitiveCount, 1);
});

test("uses both baseline and current edges so removed relationships remain reviewable", () => {
  const result = analyzeChangeImpact({
    removedFiles: [{ path: "src/legacy.ts" }],
    baselineEdges: [edge("src/consumer.ts", "src/legacy.ts")],
  });
  assert.deepEqual(result.impactedFiles.map((item) => item.path), ["src/consumer.ts"]);
});

test("deduplicates edges and safely handles dependency cycles", () => {
  const result = analyzeChangeImpact({
    modifiedFiles: ["a.ts"],
    currentEdges: [edge("b.ts", "a.ts"), edge("b.ts", "a.ts"), edge("a.ts", "b.ts")],
  });
  assert.deepEqual(result.impactedFiles.map((item) => item.path), ["b.ts"]);
});

test("returns findings attached to changed or potentially impacted files", () => {
  const result = analyzeChangeImpact({
    modifiedFiles: ["src/core.ts"],
    currentEdges: [edge("src/page.ts", "src/core.ts")],
    findings: [
      finding("changed", "src/core.ts"),
      finding("dependent", "src/page.ts"),
      finding("unrelated", "src/other.ts"),
      { id: "location", locations: [{ path: "src/page.ts", line: 9 }] },
    ],
  });
  assert.deepEqual(result.affectedFindings.map((item) => item.id), ["changed", "dependent", "location"]);
});

test("returns an empty impact result when no files changed", () => {
  const result = analyzeChangeImpact({ currentEdges: [edge("b.ts", "a.ts")] });
  assert.equal(result.changedCount, 0);
  assert.deepEqual(result.impactedFiles, []);
  assert.deepEqual(result.affectedFindings, []);
});

test("keeps independent changed files out of the impacted list", () => {
  const result = analyzeChangeImpact({
    addedFiles: ["new.ts"],
    modifiedFiles: ["core.ts"],
    currentEdges: [edge("page.ts", "core.ts")],
  });
  assert.equal(result.changedCount, 2);
  assert.deepEqual(result.impactedFiles.map((item) => item.path), ["page.ts"]);
});
