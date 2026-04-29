import fs from "fs/promises";
import path from "path";

const SOURCE_EXTENSIONS = new Set([
  ".swift",
  ".m",
  ".mm",
  ".h",
  ".pch",
  ".storyboard",
  ".xib",
  ".plist",
  ".json",
  ".yml",
  ".yaml",
]);

const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".build",
  "build",
  "DerivedData",
  "Pods",
  ".swiftpm",
]);

const MAX_FILES_SCANNED = 1800;
const MAX_MATCHES = 20;
const MAX_HINTED_ROOT_MATCHES = 12;
const MAX_SKILL_DOCS = 12;
const MAX_SNIPPET_CHARS = 320;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function toSearchableText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(toSearchableText).join(" ");
  if (typeof value === "object") {
    return Object.values(value).map(toSearchableText).join(" ");
  }
  return String(value);
}

function extractKeywords(issue) {
  const summary = String(issue?.fields?.summary || "");
  const description = toSearchableText(issue?.fields?.description);
  const merged = `${summary} ${description}`.trim();
  if (!merged) return [];

  const quotedPhrases = [
    ...merged.matchAll(/"([^"]{3,})"/g),
    ...merged.matchAll(/'([^']{3,})'/g),
  ].map((match) => match[1].trim());

  const capitalizedPhrases = [...merged.matchAll(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)\b/g)].map(
    (match) => match[1].trim()
  );

  const words = merged
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4)
    .filter((part) => !/^\d+$/.test(part));

  return unique([...quotedPhrases, ...capitalizedPhrases, ...words]).slice(0, 18);
}

function issueRawText(issue) {
  const summary = String(issue?.fields?.summary || "");
  const description = toSearchableText(issue?.fields?.description);
  return `${summary} ${description}`.trim();
}

function extractHintedRoots(issue, targetRepoPath) {
  const raw = issueRawText(issue);
  const normalizedRaw = raw.replace(/TargetSharedSources/gi, "TargetShared/Sources");
  const pathHints = normalizedRaw.match(/\b(?:TargetShared|Modules)\/[A-Za-z0-9_\-./ ]+/g) || [];
  const roots = [];

  for (const rawHint of pathHints) {
    const cleanHint = rawHint.replace(/[,.;:)\]]+$/, "").replace(/\/+$/, "");
    const absolute = path.join(targetRepoPath, cleanHint);
    roots.push(absolute);
  }

  return unique(roots);
}

function isUnderHintedRoot(relPath, hintedRootsRel) {
  return hintedRootsRel.some((root) => relPath === root || relPath.startsWith(`${root}/`));
}

function isHintedMigrationCandidate(relPath) {
  const lower = relPath.toLowerCase();
  if (!lower.endsWith(".swift")) return false;
  return (
    lower.includes("view") ||
    lower.includes("controller") ||
    lower.includes("cell") ||
    lower.includes("state") ||
    lower.includes("converter") ||
    lower.includes("adapter") ||
    lower.includes("router") ||
    lower.includes("scenebuilder") ||
    lower.includes("feature")
  );
}

function shouldSkipDir(name) {
  return SKIP_DIRECTORIES.has(name);
}

function shouldInspectFile(fileName) {
  return SOURCE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function isSkillDoc(fileName) {
  return fileName.toLowerCase().includes("skill") && fileName.toLowerCase().endsWith(".md");
}

function normalizedRelPath(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function makeSnippet(content, matchedTerm) {
  const lower = content.toLowerCase();
  const termLower = matchedTerm.toLowerCase();
  const idx = lower.indexOf(termLower);
  if (idx < 0) return "";
  const start = Math.max(0, idx - 80);
  const end = Math.min(content.length, idx + matchedTerm.length + 180);
  return content.slice(start, end).replace(/\s+/g, " ").slice(0, MAX_SNIPPET_CHARS);
}

export async function buildIssueImplementationContext({ targetRepoPath, issue }) {
  const keywords = extractKeywords(issue);
  if (!keywords.length) {
    return {
      keywords: [],
      filesScanned: 0,
      matches: [],
    };
  }

  const hintedRoots = extractHintedRoots(issue, targetRepoPath);
  const hintedRootsRel = hintedRoots.map((root) => normalizedRelPath(targetRepoPath, root));
  const queue = [...hintedRoots, targetRepoPath];
  const visitedDirs = new Set();
  let filesScanned = 0;
  const matches = [];
  let hintedRootMatches = 0;
  const skillDocs = [];

  while (queue.length && filesScanned < MAX_FILES_SCANNED) {
    const currentDir = queue.shift();
    if (visitedDirs.has(currentDir)) continue;
    visitedDirs.add(currentDir);
    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) {
          const nextDir = path.join(currentDir, entry.name);
          if (!visitedDirs.has(nextDir)) queue.push(nextDir);
        }
        continue;
      }

      if (!entry.isFile()) continue;
      if (isSkillDoc(entry.name) && skillDocs.length < MAX_SKILL_DOCS) {
        const skillPath = normalizedRelPath(targetRepoPath, path.join(currentDir, entry.name));
        skillDocs.push(skillPath);
      }
      if (!shouldInspectFile(entry.name)) continue;
      filesScanned += 1;

      const absolutePath = path.join(currentDir, entry.name);
      const relPath = normalizedRelPath(targetRepoPath, absolutePath);
      const pathLower = relPath.toLowerCase();

      if (
        hintedRootMatches < MAX_HINTED_ROOT_MATCHES &&
        isUnderHintedRoot(relPath, hintedRootsRel) &&
        isHintedMigrationCandidate(relPath)
      ) {
        matches.push({
          path: relPath,
          reason: "path under Jira hinted root",
          snippet: "",
        });
        hintedRootMatches += 1;
        if (matches.length >= MAX_MATCHES) break;
        continue;
      }

      const matchedKeywordInPath = keywords.find((keyword) => pathLower.includes(keyword.toLowerCase()));
      if (matchedKeywordInPath) {
        matches.push({
          path: relPath,
          reason: `path matches '${matchedKeywordInPath}'`,
          snippet: "",
        });
        if (matches.length >= MAX_MATCHES) break;
        continue;
      }

      const content = await fs.readFile(absolutePath, "utf8").catch(() => "");
      if (!content) continue;

      const matchedKeywordInContent = keywords.find((keyword) =>
        content.toLowerCase().includes(keyword.toLowerCase())
      );
      if (matchedKeywordInContent) {
        matches.push({
          path: relPath,
          reason: `content matches '${matchedKeywordInContent}'`,
          snippet: makeSnippet(content, matchedKeywordInContent),
        });
      }

      if (matches.length >= MAX_MATCHES) break;
    }
  }

  return {
    keywords,
    filesScanned,
    matches,
    skillDocs,
    hintedRoots: hintedRootsRel,
  };
}
