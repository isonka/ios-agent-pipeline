import fs from "fs/promises";
import path from "path";

const MAX_MD_FILES = 24;
const MAX_FILE_CHARS = 5000;

function priorityScore(relativePath) {
  const normalized = relativePath.toLowerCase();
  if (normalized.endsWith("readme.md")) return -30;
  if (normalized.endsWith("claude.md")) return -20;
  if (normalized.endsWith("skill.md")) return -10;
  if (normalized.includes("/skills/")) return -8;
  return 0;
}

async function walkMarkdownFiles(rootDir, relativeDir = "") {
  const absoluteDir = path.join(rootDir, relativeDir);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });

  let files = [];
  for (const entry of entries) {
    const relPath = path.join(relativeDir, entry.name);
    if (relPath.startsWith(".git")) continue;
    if (relPath.includes("node_modules")) continue;
    if (relPath.includes(".build")) continue;

    if (entry.isDirectory()) {
      const nested = await walkMarkdownFiles(rootDir, relPath);
      files = files.concat(nested);
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(relPath);
    }
  }

  return files;
}

export async function buildProjectContext(targetRepoPath) {
  const allMdFiles = await walkMarkdownFiles(targetRepoPath);
  const prioritized = allMdFiles
    .sort((a, b) => a.localeCompare(b))
    .sort((a, b) => priorityScore(a) - priorityScore(b))
    .slice(0, MAX_MD_FILES);

  const docs = [];
  for (const relativePath of prioritized) {
    const absolutePath = path.join(targetRepoPath, relativePath);
    const content = await fs.readFile(absolutePath, "utf8").catch(() => "");
    docs.push({
      path: relativePath,
      content: content.slice(0, MAX_FILE_CHARS),
    });
  }

  return {
    docsScanned: docs.length,
    docPaths: docs.map((doc) => doc.path),
    docs,
  };
}
