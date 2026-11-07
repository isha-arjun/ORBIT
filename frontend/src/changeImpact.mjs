const MAX_IMPACTED_FILES = 100;

/**
 * Estimate files that may need review when a set of files changes.
 * Dependency edges point from importer (from) to imported file (to), so
 * impact travels against the edge direction. Baseline and current edges are
 * combined to retain relationships that were added or removed between scans.
 */
export function analyzeChangeImpact({
  addedFiles = [],
  removedFiles = [],
  modifiedFiles = [],
  baselineEdges = [],
  currentEdges = [],
  findings = [],
}) {
  const changed = new Set(
    [...addedFiles, ...removedFiles, ...modifiedFiles].map((item) =>
      typeof item === "string" ? item : item.path,
    ).filter(Boolean),
  );

  const reverse = new Map();
  for (const edge of [...baselineEdges, ...currentEdges]) {
    if (!edge || typeof edge.from !== "string" || typeof edge.to !== "string") continue;
    if (!reverse.has(edge.to)) reverse.set(edge.to, new Set());
    reverse.get(edge.to).add(edge.from);
  }

  const distance = new Map();
  const queue = [];
  for (const path of [...changed].sort()) {
    distance.set(path, 0);
    queue.push(path);
  }

  for (let index = 0; index < queue.length && distance.size <= MAX_IMPACTED_FILES + changed.size; index += 1) {
    const path = queue[index];
    const nextDistance = distance.get(path) + 1;
    for (const dependent of [...(reverse.get(path) || [])].sort()) {
      if (!distance.has(dependent)) {
        distance.set(dependent, nextDistance);
        queue.push(dependent);
      }
    }
  }

  const impactedFiles = [...distance.entries()]
    .filter(([path, depth]) => depth > 0 && !changed.has(path))
    .map(([path, depth]) => ({ path, depth, relation: depth === 1 ? "direct" : "transitive" }))
    .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path))
    .slice(0, MAX_IMPACTED_FILES);

  const impactedPaths = new Set([...changed, ...impactedFiles.map((item) => item.path)]);
  const affectedFindings = findings.filter((finding) => {
    const paths = [finding.path, ...(finding.locations || []).map((item) => item.path)].filter(Boolean);
    return paths.some((path) => impactedPaths.has(path));
  });

  return {
    changedCount: changed.size,
    impactedFiles,
    directCount: impactedFiles.filter((item) => item.depth === 1).length,
    transitiveCount: impactedFiles.filter((item) => item.depth > 1).length,
    affectedFindings,
    truncated: [...distance.entries()].filter(([path, depth]) => depth > 0 && !changed.has(path)).length > MAX_IMPACTED_FILES,
  };
}
