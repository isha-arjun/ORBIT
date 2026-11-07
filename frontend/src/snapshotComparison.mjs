const SOURCE_EXTENSIONS = new Set([".py", ".pyi", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".gd"]);

/**
 * Compare two file inventories using one-way content fingerprints only.
 * Older snapshots remain supported, but shared source files need hashes for a complete result.
 */
export function compareSnapshotFiles(baselineFiles, currentFiles) {
  const baselinePaths = new Set(baselineFiles.map((file) => file.path));
  const currentPaths = new Set(currentFiles.map((file) => file.path));
  const currentByPath = new Map(currentFiles.map((file) => [file.path, file]));

  const addedFiles = currentFiles.filter((file) => !baselinePaths.has(file.path));
  const removedFiles = baselineFiles.filter((file) => !currentPaths.has(file.path));
  const baselineSourceFiles = baselineFiles.filter((file) => SOURCE_EXTENSIONS.has(file.extension));
  const currentSourceFiles = currentFiles.filter((file) => SOURCE_EXTENSIONS.has(file.extension));
  const sharedSourceFiles = baselineSourceFiles.filter((file) => currentPaths.has(file.path));

  const modifiedFiles = sharedSourceFiles.filter((file) => {
    const current = currentByPath.get(file.path);
    return Boolean(file.content_sha256 && current?.content_sha256 && file.content_sha256 !== current.content_sha256);
  });

  const comparable = baselineSourceFiles.length === 0
    || currentSourceFiles.length === 0
    || sharedSourceFiles.length === 0
    || sharedSourceFiles.every((file) => {
      const current = currentByPath.get(file.path);
      return Boolean(file.content_sha256 && current?.content_sha256);
    });

  return { addedFiles, removedFiles, modifiedFiles, comparable };
}
