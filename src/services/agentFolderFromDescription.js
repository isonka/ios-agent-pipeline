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
