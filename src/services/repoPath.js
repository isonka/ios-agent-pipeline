import fs from "fs/promises";
import path from "path";

export async function resolveTargetRepoPath(inputPath, fallbackPath = "") {
  const selectedPath = inputPath || fallbackPath;
  if (!selectedPath) {
    throw new Error("targetRepoPath is required when TARGET_PROJECT_PATH is not set.");
  }

  const absolutePath = path.resolve(selectedPath);
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Invalid targetRepoPath: '${absolutePath}' is not a directory.`);
  }

  const gitStat = await fs.stat(path.join(absolutePath, ".git")).catch(() => null);
  if (!gitStat || !gitStat.isDirectory()) {
    throw new Error(`Invalid targetRepoPath: '${absolutePath}' must point to a git repo root.`);
  }

  return absolutePath;
}
