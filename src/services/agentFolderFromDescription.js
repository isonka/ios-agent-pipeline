/**
 * Expect a line in the issue description (plain text): Agent folder: path/to/folder
 * Path is relative to repo root, forward slashes; no ".." or absolute paths.
 */
const AGENT_FOLDER_LINE = /^\s*Agent\s+folder\s*:\s*(.+?)\s*$/i;

export function extractAgentFolderRelPath(descriptionPlain) {
  const text = String(descriptionPlain || "");
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(AGENT_FOLDER_LINE);
    if (match) {
      return normalizeRelPath(match[1]);
    }
  }
  return null;
}

function normalizeRelPath(raw) {
  return String(raw || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

/** First line matching `Agent folder: ...` (trimmed), or null. */
export function extractAgentFolderLine(descriptionPlain) {
  const lines = String(descriptionPlain || "").split(/\r?\n/);
  for (const line of lines) {
    if (/^\s*Agent\s+folder\s*:\s*.+$/i.test(line)) {
      return line.trim();
    }
  }
  return null;
}

/** Remove `Agent folder: ...` lines so routing metadata is not sent to the LLM as story text. */
export function stripAgentFolderLines(descriptionPlain) {
  return String(descriptionPlain || "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*Agent\s+folder\s*:\s*.+$/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
