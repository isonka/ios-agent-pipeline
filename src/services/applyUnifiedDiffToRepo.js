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

  const result = spawnSync("git", ["apply", "--whitespace=nowarn", "-"], {
    cwd: repoRoot,
    input: diff,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.status !== 0) {
    const err = [result.stderr, result.stdout].filter(Boolean).join("\n").trim() || `exit ${result.status}`;
    throw new Error(`git apply failed: ${err}`);
  }
}
