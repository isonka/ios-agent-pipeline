import fs from "fs/promises";
import path from "path";

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function runFilePath(runStateDir, issueKey) {
  return path.join(runStateDir, `${issueKey}.json`);
}

export async function loadRunState(runStateDir, issueKey) {
  await ensureDir(runStateDir);
  const filePath = runFilePath(runStateDir, issueKey);
  const raw = await fs.readFile(filePath, "utf8").catch(() => "");
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function saveRunState(runStateDir, issueKey, data) {
  await ensureDir(runStateDir);
  const filePath = runFilePath(runStateDir, issueKey);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}
