import test from "node:test";
import assert from "node:assert/strict";
import { buildDeveloperActions, rankCodebaseMatches } from "./developerGuide.mjs";

const files = [
  { path: "src/auth/session.ts", name: "session.ts", language: "TypeScript" },
  { path: "src/routes/index.ts", name: "index.ts", language: "TypeScript" },
  { path: "src/utils/date.ts", name: "date.ts", language: "TypeScript" },
];
const insights = [
  { path: "src/auth/session.ts", status: "analyzed", functions: [{ name: "refreshSession" }], imports: ["./token"] },
  { path: "src/routes/index.ts", status: "analyzed", functions: [{ name: "registerRoutes" }], imports: ["../auth/session"] },
  { path: "src/utils/date.ts", status: "parse_error" },
];

test("ranks a matching path and symbol with grounded reasons", () => {
  const results = rankCodebaseMatches("refreshSession", files, insights, []);
  assert.equal(results[0].path, "src/auth/session.ts");
  assert.ok(results[0].reasons.includes("Detected symbol matches"));
});

test("surfaces review actions and parser errors", () => {
  const actions = buildDeveloperActions(files, insights, [{ title: "Unresolved import", detail: "Check import", severity: "medium" }], { edges: [{ from: "src/routes/index.ts", to: "src/auth/session.ts" }] });
  assert.ok(actions.some((item) => item.id === "findings"));
  assert.ok(actions.some((item) => item.id === "parse"));
  assert.ok(actions.some((item) => item.id === "central"));
});

test("returns no matches for an empty query", () => {
  assert.deepEqual(rankCodebaseMatches("", files, insights, []), []);
});
