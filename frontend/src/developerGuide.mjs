export function rankCodebaseMatches(query, files = [], insights = [], findings = []) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return [];
  const tokens = normalized.split(/[^a-z0-9_./-]+/).filter(Boolean);
  const insightByPath = new Map(insights.map((item) => [item.path, item]));
  const findingByPath = new Map();
  for (const finding of findings) {
    if (finding.path) {
      const current = findingByPath.get(finding.path) || [];
      current.push(finding);
      findingByPath.set(finding.path, current);
    }
  }
  return files.map((file) => {
    const insight = insightByPath.get(file.path);
    const symbols = [
      ...(insight?.functions || []).map((item) => item.name),
      ...(insight?.classes || []).map((item) => item.name),
      ...(insight?.signals || []).map((item) => item.name),
    ];
    const imports = insight?.imports || [];
    const attachedFindings = findingByPath.get(file.path) || [];
    const haystack = [file.path, file.name, file.language, ...symbols, ...imports,
      ...attachedFindings.flatMap((item) => [item.title, item.detail, item.evidence || ""])].join(" ").toLowerCase();
    let score = 0;
    const reasons = [];
    if (file.path.toLowerCase().includes(normalized)) { score += 12; reasons.push("Path matches your query"); }
    for (const token of tokens) {
      if (file.path.toLowerCase().includes(token)) score += 5;
      if (symbols.some((value) => value.toLowerCase().includes(token))) { score += 4; if (!reasons.includes("Detected symbol matches")) reasons.push("Detected symbol matches"); }
      if (imports.some((value) => value.toLowerCase().includes(token))) { score += 3; if (!reasons.includes("Import matches")) reasons.push("Import matches"); }
      if (attachedFindings.some((item) => [item.title, item.detail, item.evidence || ""].join(" ").toLowerCase().includes(token))) { score += 3; if (!reasons.includes("Related finding exists")) reasons.push("Related finding exists"); }
      if (file.language.toLowerCase().includes(token)) score += 2;
    }
    if (haystack.includes(normalized)) score += 2;
    return { path: file.path, language: file.language, score, reasons, findingCount: attachedFindings.length, symbols: symbols.slice(0, 4) };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, 8);
}

export function buildDeveloperActions(files = [], insights = [], findings = [], graph) {
  const actions = [];
  const openFindings = findings.filter((item) => item.severity === "medium");
  if (openFindings.length) {
    actions.push({ id: "findings", title: "Review the highest-priority findings", detail: openFindings.length + " review-level signal(s) deserve a closer look.", target: "project-issues", count: openFindings.length, kind: "review" });
  }
  const parseErrors = insights.filter((item) => item.status === "parse_error");
  if (parseErrors.length) {
    actions.push({ id: "parse", title: "Check files the parser could not read", detail: "Start with " + parseErrors[0].path + ". Check syntax or parser support before drawing conclusions.", path: parseErrors[0].path, count: parseErrors.length, kind: "file" });
  }
  const highComplexity = insights.filter((item) => (item.complexity_estimate || 0) >= 15).sort((a, b) => (b.complexity_estimate || 0) - (a.complexity_estimate || 0));
  if (highComplexity.length) {
    actions.push({ id: "complexity", title: "Inspect high branch-count estimates", detail: highComplexity.length + " file(s) have a rough branch estimate of 15 or more. This is a review signal, not a quality score.", path: highComplexity[0].path, count: highComplexity.length, kind: "file" });
  }
  const edges = graph?.edges || [];
  const incoming = new Map();
  for (const edge of edges) incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
  const central = [...incoming.entries()].sort((a, b) => b[1] - a[1])[0];
  if (central) actions.push({ id: "central", title: "Understand a highly reused module", detail: central[0] + " is imported by " + central[1] + " mapped file(s). Changes here may deserve extra review.", path: central[0], count: central[1], kind: "file" });
  if (!actions.length && files.length) {
    actions.push({ id: "explore", title: "Explore the project structure", detail: "Start with the largest source folders, then inspect a few central modules and their imports.", target: "project-explorer", count: files.length, kind: "explore" });
  }
  return actions.slice(0, 4);
}
