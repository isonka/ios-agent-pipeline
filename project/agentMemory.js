import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MEMORY_DIR = ".data/agent-memory";
const DEFAULT_MAX_ENTRIES = 50;
const ALLOWED_AGENTS = new Set(["architect", "developer", "tester", "reviewer"]);

function normalizeAgent(agent) {
  const key = String(agent || "").toLowerCase();
  if (!ALLOWED_AGENTS.has(key)) {
    throw new Error(`Unsupported agent memory scope: ${agent}`);
  }
  return key;
}

function getMemoryDir() {
  const configured = process.env.AGENT_MEMORY_DIR || DEFAULT_MEMORY_DIR;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

function getMemoryFilePath(agent) {
  const key = normalizeAgent(agent);
  return path.join(getMemoryDir(), `${key}.json`);
}

function getMaxEntries() {
  const parsed = Number(process.env.AGENT_MEMORY_MAX_ENTRIES || DEFAULT_MAX_ENTRIES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ENTRIES;
}

async function ensureParentDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export async function loadAgentMemory(agent) {
  const memoryPath = getMemoryFilePath(agent);
  try {
    const raw = await readFile(memoryPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      agent: normalizeAgent(agent),
      version: parsed.version || 1,
      updatedAt: parsed.updatedAt || null,
      feedback: Array.isArray(parsed.feedback) ? parsed.feedback : [],
    };
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return { agent: normalizeAgent(agent), version: 1, updatedAt: null, feedback: [] };
    }
    throw err;
  }
}

export async function appendAgentFeedback(agent, entry) {
  const key = normalizeAgent(agent);
  const memoryPath = getMemoryFilePath(key);
  const current = await loadAgentMemory(key);
  const normalized = {
    timestamp: new Date().toISOString(),
    issueKey: entry.issueKey || "unknown",
    rating: entry.rating || "neutral",
    whatWorked: entry.whatWorked || "",
    whatFailed: entry.whatFailed || "",
    expectations: entry.expectations || "",
    notes: entry.notes || "",
    source: entry.source || "manual",
  };

  const merged = [...current.feedback, normalized];
  const trimmed = merged.slice(-getMaxEntries());
  const next = {
    agent: key,
    version: 1,
    updatedAt: new Date().toISOString(),
    feedback: trimmed,
  };

  await ensureParentDir(memoryPath);
  await writeFile(memoryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function formatAgentMemoryForPrompt(memory) {
  const entries = Array.isArray(memory?.feedback) ? memory.feedback : [];
  if (!entries.length) return "No prior feedback memory.";

  return entries.slice(-15).map((item, idx) => [
    `Feedback #${idx + 1}`,
    `- issueKey: ${item.issueKey || "unknown"}`,
    `- rating: ${item.rating || "neutral"}`,
    `- whatWorked: ${item.whatWorked || "n/a"}`,
    `- whatFailed: ${item.whatFailed || "n/a"}`,
    `- expectations: ${item.expectations || "n/a"}`,
    `- notes: ${item.notes || "n/a"}`,
    `- source: ${item.source || "manual"}`,
  ].join("\n")).join("\n\n");
}
