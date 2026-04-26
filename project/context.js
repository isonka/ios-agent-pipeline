import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const MANDATORY_DOCS = ["README.md", "CLAUDE.md"];
const OPTIONAL_SKILLS_DIRS = ["skills", ".cursor/skills", ".claude/skills"];
const MAX_DOC_CHARS = 4000;
let cachedFormattedContext = null;

function shorten(text, maxChars = MAX_DOC_CHARS) {
  if (!text) return "";
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

async function readIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

async function listFilesIfExists(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
}

export async function buildProjectContext() {
  const projectPath = process.env.TARGET_PROJECT_PATH;
  if (!projectPath) {
    throw new Error("Missing TARGET_PROJECT_PATH. Set it in your environment.");
  }

  const docContents = {};
  const missing = [];
  for (const file of MANDATORY_DOCS) {
    const content = await readIfExists(path.join(projectPath, file));
    if (!content) {
      missing.push(file);
      continue;
    }
    docContents[file] = shorten(content);
  }

  if (missing.length) {
    throw new Error(
      `Missing mandatory project docs in ${projectPath}: ${missing.join(", ")}`
    );
  }

  const skills = [];
  for (const skillsDir of OPTIONAL_SKILLS_DIRS) {
    const absolute = path.join(projectPath, skillsDir);
    const files = await listFilesIfExists(absolute);
    if (files.length) {
      skills.push({ directory: skillsDir, files });
    }
  }

  return {
    projectPath,
    requiredDocs: {
      readme: docContents["README.md"],
      claude: docContents["CLAUDE.md"],
    },
    optionalSkills: skills,
  };
}

export function formatProjectContextForPrompt(context) {
  const skillsSummary = context.optionalSkills.length
    ? context.optionalSkills
        .map((bucket) => `- ${bucket.directory}: ${bucket.files.join(", ")}`)
        .join("\n")
    : "- none found";

  return [
    `Project path: ${context.projectPath}`,
    "",
    "Mandatory docs (must drive implementation decisions):",
    "",
    "README.md:",
    context.requiredDocs.readme,
    "",
    "CLAUDE.md:",
    context.requiredDocs.claude,
    "",
    "Optional skills inventory:",
    skillsSummary,
  ].join("\n");
}

export async function getProjectContextForPromptCached({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedFormattedContext) {
    return cachedFormattedContext;
  }

  const built = await buildProjectContext();
  cachedFormattedContext = formatProjectContextForPrompt(built);
  return cachedFormattedContext;
}

export function resetProjectContextCache() {
  cachedFormattedContext = null;
}
