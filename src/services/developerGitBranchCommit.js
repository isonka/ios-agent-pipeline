import { spawnSync } from "child_process";
import { stripDiffMarkdownFences } from "./applyUnifiedDiffToRepo.js";

/**
 * Git branch segment: lowercase, hyphen-separated, safe for `git checkout -b`.
 */
export function slugifyGitBranchSegment(raw, maxLen = 48) {
  let s = String(raw || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/-+$/, "");
  return s || "change";
}

/**
 * Paths touched in a unified diff (`+++ b/...`), for targeted `git add`.
 * Handles `+++ b/path\t(...)` from git diff.
 */
export function pathsFromUnifiedDiff(patchText) {
  const d = stripDiffMarkdownFences(patchText).replace(/\r\n/g, "\n");
  const out = [];
  for (const line of d.split("\n")) {
    const m = line.match(/^\+\+\+ b\/(.+)$/);
    if (!m) continue;
    let p = m[1].trim();
    const tab = p.indexOf("\t");
    if (tab !== -1) p = p.slice(0, tab);
    if (p === "/dev/null") continue;
    out.push(p);
  }
  return [...new Set(out)];
}

/** @param {{ emailAddress?: string, displayName?: string } | null | undefined} assignee */
export function resolveDeveloperUserSlug(assignee) {
  const env = process.env.DEVELOPER_BRANCH_USER_SLUG;
  if (env && String(env).trim()) return slugifyGitBranchSegment(env.trim(), 32);
  const email = assignee?.emailAddress;
  if (email && email.includes("@")) {
    const local = email.split("@")[0];
    if (local) return slugifyGitBranchSegment(local, 32);
  }
  const dn = assignee?.displayName;
  if (dn) return slugifyGitBranchSegment(dn.replace(/\s+/g, " "), 32);
  return "developer";
}

const MAX_BRANCH_LEN = 200;

/**
 * Convention: `feat/{userSlug}/{ISSUEKEY}-{summary-slug}` (e.g. feat/okarsli/MP-17833-add-login).
 */
export function buildDeveloperBranchBaseName({ issueKey, summary, userSlug }) {
  const key = String(issueKey || "").trim();
  if (!key) throw new Error("issueKey is required for developer branch name.");
  const su = slugifyGitBranchSegment(userSlug, 32);
  const prefix = `feat/${su}/${key}-`;
  const room = MAX_BRANCH_LEN - prefix.length;
  const sum = slugifyGitBranchSegment(summary, Math.max(8, room));
  return `${prefix}${sum}`;
}

function git(repoRoot, args, opts = {}) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...opts,
  });
}

function localBranchExists(repoRoot, name) {
  const r = git(repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]);
  return r.status === 0;
}

export function ensureUniqueLocalBranchName(repoRoot, baseName) {
  const base = baseName.slice(0, MAX_BRANCH_LEN);
  let candidate = base;
  let n = 2;
  while (localBranchExists(repoRoot, candidate)) {
    candidate = `${base}-${n}`.slice(0, MAX_BRANCH_LEN);
    n += 1;
    if (n > 100) throw new Error("Could not allocate a unique local branch name.");
  }
  return candidate;
}

/**
 * Assumes patch already applied to working tree. Creates a new local branch, stages changes
 * for paths from the patch (or `git add -u` if none parsed), commits once.
 *
 * @returns {{ branch: string, commitSha: string }}
 */
export function checkoutNewBranchAndCommitAppliedPatch(repoRoot, { issueKey, summary, assignee, patchText }) {
  const inside = git(repoRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || String(inside.stdout || "").trim() !== "true") {
    throw new Error("Target repo path is not a git repository (git rev-parse failed).");
  }

  const userSlug = resolveDeveloperUserSlug(assignee);
  const base = buildDeveloperBranchBaseName({
    issueKey,
    summary: summary || "",
    userSlug,
  });
  const branch = ensureUniqueLocalBranchName(repoRoot, base);

  const co = git(repoRoot, ["checkout", "-b", branch]);
  if (co.status !== 0) {
    const err = [co.stderr, co.stdout].filter(Boolean).join("\n").trim() || `exit ${co.status}`;
    throw new Error(`git checkout -b failed: ${err}`);
  }

  const paths = pathsFromUnifiedDiff(patchText);
  if (paths.length) {
    for (const p of paths) {
      const add = git(repoRoot, ["add", "--", p]);
      if (add.status !== 0) {
        const err = [add.stderr, add.stdout].filter(Boolean).join("\n").trim() || `exit ${add.status}`;
        throw new Error(`git add failed for ${p}: ${err}`);
      }
    }
  } else {
    const addu = git(repoRoot, ["add", "-u"]);
    if (addu.status !== 0) {
      const err = [addu.stderr, addu.stdout].filter(Boolean).join("\n").trim() || `exit ${addu.status}`;
      throw new Error(`git add -u failed: ${err}`);
    }
  }

  const empty = git(repoRoot, ["diff", "--cached", "--quiet"]);
  if (empty.status === 0) {
    throw new Error("Nothing to commit after apply (empty index). Check patch and repo state.");
  }

  const msgSubject = `[${issueKey}] Developer pipeline`;
  const msgBody = `${String(summary || "").slice(0, 500)}\n\nJira: ${issueKey}`;
  const commit = git(repoRoot, ["commit", "-m", msgSubject, "-m", msgBody]);
  if (commit.status !== 0) {
    const err = [commit.stderr, commit.stdout].filter(Boolean).join("\n").trim() || `exit ${commit.status}`;
    throw new Error(`git commit failed: ${err}`);
  }

  const head = git(repoRoot, ["rev-parse", "HEAD"]);
  if (head.status !== 0) {
    throw new Error("git rev-parse HEAD failed after commit.");
  }
  const commitSha = String(head.stdout || "").trim();
  return { branch, commitSha };
}
