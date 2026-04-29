import fs from "fs/promises";
import path from "path";

const ARCHITECT_MEMORY_RELATIVE_PATH = ".ios-agent/architect-context.json";

function architectMemoryPath(targetRepoPath) {
  return path.join(targetRepoPath, ARCHITECT_MEMORY_RELATIVE_PATH);
}

export async function loadArchitectMemory(targetRepoPath) {
  const filePath = architectMemoryPath(targetRepoPath);
  const raw = await fs.readFile(filePath, "utf8").catch(() => "");
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function saveArchitectMemory(targetRepoPath, data) {
  const filePath = architectMemoryPath(targetRepoPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export function getArchitectMemoryRelativePath() {
  return ARCHITECT_MEMORY_RELATIVE_PATH;
}
