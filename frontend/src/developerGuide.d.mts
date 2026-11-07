export type DeveloperMatch = {
  path: string;
  language: string;
  score: number;
  reasons: string[];
  findingCount: number;
  symbols: string[];
};

export type DeveloperAction = {
  id: string;
  title: string;
  detail: string;
  target?: string;
  path?: string;
  count: number;
  kind: "review" | "file" | "explore";
};

export function rankCodebaseMatches(
  query: string,
  files?: Array<{ path: string; name: string; language: string }>,
  insights?: Array<{
    path: string;
    functions?: Array<{ name: string }>;
    classes?: Array<{ name: string }>;
    signals?: Array<{ name: string }>;
    imports?: string[];
  }>,
  findings?: Array<{ path?: string; title: string; detail: string; evidence?: string }>
): DeveloperMatch[];

export function buildDeveloperActions(
  files?: Array<{ path: string; name: string; language: string }>,
  insights?: Array<{ path: string; status: string; complexity_estimate?: number | null }>,
  findings?: Array<{ title: string; detail: string; severity: "medium" | "info"; path?: string }>,
  graph?: { edges?: Array<{ from: string; to: string }> }
): DeveloperAction[];
