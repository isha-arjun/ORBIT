export type FingerprintedProjectFile = {
  path: string;
  extension: string;
  content_sha256?: string;
};

export function compareSnapshotFiles<T extends FingerprintedProjectFile>(
  baselineFiles: T[],
  currentFiles: T[],
): {
  addedFiles: T[];
  removedFiles: T[];
  modifiedFiles: T[];
  comparable: boolean;
};
