import fs from "fs/promises";
import path from "path";

/**
 * Resolve {repoRoot}/{folderRel}/claude.md and read it. Rejects path traversal.
 */
export async function loadClaudeMdFromRepoFolder({ repoRoot, folderRel }) {
  const normalized = String(folderRel || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");

  if (!normalized || normalized.includes("..")) {
    throw new Error("Invalid Agent folder value (empty or contains '..').");
  }

  const absDir = path.resolve(repoRoot, normalized);
  const relDir = path.relative(repoRoot, absDir);
  const relPosix = relDir.split(path.sep).join("/");

  if (relPosix.startsWith("..") || path.isAbsolute(relDir)) {
    throw new Error("Agent folder resolves outside the repo root.");
  }

  const claudeAbs = path.join(absDir, "claude.md");
  const claudeRel = `${relPosix}/claude.md`;

  const stat = await fs.stat(claudeAbs).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw new Error(`Missing claude.md at repo path: ${claudeRel}`);
  }

  const content = await fs.readFile(claudeAbs, "utf8");
  return { content, claudeRelativePath: claudeRel };
}
