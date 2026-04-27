import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MEMORY_FILE = ".data/architect-memory.json";
const DEFAULT_MAX_ENTRIES = 50;

function getMemoryFilePath() {
  const configured = process.env.ARCHITECT_MEMORY_FILE || DEFAULT_MEMORY_FILE;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

function getMaxEntries() {
  const parsed = Number(process.env.ARCHITECT_MEMORY_MAX_ENTRIES || DEFAULT_MAX_ENTRIES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ENTRIES;
}

async function ensureParentDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export async function loadArchitectMemory() {
  const memoryPath = getMemoryFilePath();
  try {
    const raw = await readFile(memoryPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: parsed.version || 1,
      updatedAt: parsed.updatedAt || null,
      feedback: Array.isArray(parsed.feedback) ? parsed.feedback : [],
    };
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return { version: 1, updatedAt: null, feedback: [] };
    }
    throw err;
  }
}

export async function appendArchitectFeedback(entry) {
  const memoryPath = getMemoryFilePath();
  const current = await loadArchitectMemory();
  const normalized = {
    timestamp: new Date().toISOString(),
    issueKey: entry.issueKey || "unknown",
    rating: entry.rating || "neutral",
    whatWorked: entry.whatWorked || "",
    whatFailed: entry.whatFailed || "",
    expectations: entry.expectations || "",
    developerNotes: entry.developerNotes || "",
  };

  const merged = [...current.feedback, normalized];
  const maxEntries = getMaxEntries();
  const trimmed = merged.slice(-maxEntries);
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    feedback: trimmed,
  };

  await ensureParentDir(memoryPath);
  await writeFile(memoryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function formatArchitectMemoryForPrompt(memory) {
  const entries = Array.isArray(memory?.feedback) ? memory.feedback : [];
  if (!entries.length) {
    return "No prior architect feedback memory.";
  }

  const lines = entries.slice(-15).map((item, idx) => [
    `Feedback #${idx + 1}`,
    `- issueKey: ${item.issueKey || "unknown"}`,
    `- rating: ${item.rating || "neutral"}`,
    `- whatWorked: ${item.whatWorked || "n/a"}`,
    `- whatFailed: ${item.whatFailed || "n/a"}`,
    `- expectations: ${item.expectations || "n/a"}`,
    `- developerNotes: ${item.developerNotes || "n/a"}`,
  ].join("\n"));

  return lines.join("\n\n");
}
