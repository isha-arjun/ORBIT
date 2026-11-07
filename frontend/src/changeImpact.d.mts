export type ImpactFile = string | { path: string };
export type ImpactEdge = { from: string; to: string; specifier?: string };
export type ImpactFinding = {
  id: string;
  title?: string;
  detail?: string;
  path?: string;
  locations?: { path: string; line?: number }[];
  [key: string]: unknown;
};
export type ChangeImpactResult = {
  changedCount: number;
  impactedFiles: { path: string; depth: number; relation: "direct" | "transitive" }[];
  directCount: number;
  transitiveCount: number;
  affectedFindings: ImpactFinding[];
  truncated: boolean;
};
export function analyzeChangeImpact(input: {
  addedFiles?: ImpactFile[];
  removedFiles?: ImpactFile[];
  modifiedFiles?: ImpactFile[];
  baselineEdges?: ImpactEdge[];
  currentEdges?: ImpactEdge[];
  findings?: ImpactFinding[];
}): ChangeImpactResult;
