import { spawnSync } from "child_process";

/**
 * Strip markdown code fences often wrapped around LLM diffs.
 */
export function stripDiffMarkdownFences(text) {
  const t = String(text || "").replace(/\r\n/g, "\n");
  const lead = t.trimStart();
  if (!lead.startsWith("```")) return lead;
  const m = t.match(/```(?:diff)?\s*([\s\S]*?)```/i);
  return (m?.[1] ?? lead).trim();
}

function isHunkBodyLine(line) {
  if (!line.length) return false;
  const c = line[0];
  return c === " " || c === "+" || c === "-" || c === "\\";
}

/**
 * LLMs often emit completely blank lines inside hunks; `git apply` rejects those
 * ("corrupt patch") because every hunk line must start with space, +, -, or \\.
 * Turn such lines into a single-space context line (` `).
 *
 * Keeps a real blank line before `diff --git` when concatenating multiple files.
 */
export function normalizePatchForGitApply(text) {
  let d = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!d.endsWith("\n")) d += "\n";
  const lines = d.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const out = [];
  let inHunk = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^diff --git /.test(line)) {
      inHunk = false;
      out.push(line);
      continue;
    }
    if (/^@@/.test(line)) {
      inHunk = true;
      out.push(line);
      continue;
    }
    if (inHunk && line === "") {
      const next = lines[i + 1] ?? "";
      if (/^diff --git /.test(next)) {
        inHunk = false;
        out.push("");
      } else {
        out.push(" ");
      }
      continue;
    }
    if (inHunk) {
      if (isHunkBodyLine(line)) {
        out.push(line);
        continue;
      }
      inHunk = false;
    }
    out.push(line);
  }
  const joined = out.join("\n");
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}

function formatGitApplyError(result) {
  return [result.stderr, result.stdout].filter(Boolean).join("\n").trim() || `exit ${result.status}`;
}

/**
 * Apply a unified diff to the repo working tree using `git apply` (stdin).
 * Does not commit; leaves changes unstaged for human review.
 *
 * @param {string} repoRoot Absolute path to git repo root
 * @param {string} patchText Unified diff (may include ```diff fences)
 */
export function applyUnifiedDiffToRepo(repoRoot, patchText) {
  let diff = stripDiffMarkdownFences(patchText);
  if (!diff.endsWith("\n")) diff += "\n";
  if (!diff.trim()) {
    throw new Error("patchProposal is empty.");
  }

  diff = normalizePatchForGitApply(diff);

  const baseArgs = ["apply", "--whitespace=nowarn", "--recount", "--inaccurate-eof"];
  const attempts = [baseArgs, [...baseArgs, "--ignore-space-change"]];

  let lastErr = "";
  for (const args of attempts) {
    const result = spawnSync("git", [...args, "-"], {
      cwd: repoRoot,
      input: diff,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.status === 0) return;
    lastErr = formatGitApplyError(result);
  }

  throw new Error(`git apply failed: ${lastErr}`);
}
