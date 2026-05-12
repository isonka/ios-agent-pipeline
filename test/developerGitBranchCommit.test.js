import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { applyUnifiedDiffToRepo } from "../src/services/applyUnifiedDiffToRepo.js";
import {
  slugifyGitBranchSegment,
  pathsFromUnifiedDiff,
  resolveDeveloperUserSlug,
  buildDeveloperBranchBaseName,
  ensureUniqueLocalBranchName,
  checkoutNewBranchAndCommitAppliedPatch,
} from "../src/services/developerGitBranchCommit.js";

test("slugifyGitBranchSegment normalizes", () => {
  assert.equal(slugifyGitBranchSegment("Hello World!"), "hello-world");
  assert.equal(slugifyGitBranchSegment("  "), "change");
});

test("pathsFromUnifiedDiff parses +++ b lines and tabs", () => {
  const diff = "diff --git a/x b/x\n+++ b/src/App.swift\tdate\n+++ b/src/App.swift\n";
  assert.deepEqual(pathsFromUnifiedDiff(diff), ["src/App.swift"]);
});

test("resolveDeveloperUserSlug uses email local part", () => {
  assert.equal(resolveDeveloperUserSlug({ emailAddress: "okarsli@example.com" }), "okarsli");
});

test("resolveDeveloperUserSlug uses displayName when no email", () => {
  assert.equal(resolveDeveloperUserSlug({ displayName: "Omer Karsli" }), "omer-karsli");
});

test("buildDeveloperBranchBaseName matches feat/user/KEY-slug pattern", () => {
  const b = buildDeveloperBranchBaseName({
    issueKey: "MP-17833",
    summary: "Add login flow",
    userSlug: "okarsli",
  });
  assert.match(b, /^feat\/okarsli\/MP-17833-/);
  assert.ok(b.includes("add-login-flow") || b.includes("add-login"));
});

test("checkoutNewBranchAndCommitAppliedPatch creates branch and commit", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "ios-agent-branch-"));
  execFileSync("git", ["init"], { cwd: repo, encoding: "utf8" });
  execFileSync("git", ["config", "user.email", "test@test.local"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "test"], { cwd: repo });
  await fs.writeFile(path.join(repo, "hello.txt"), "v1\n", "utf8");
  execFileSync("git", ["add", "hello.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repo });
  await fs.writeFile(path.join(repo, "hello.txt"), "v2\n", "utf8");
  const diff = execFileSync("git", ["diff", "hello.txt"], { cwd: repo, encoding: "utf8" });
  execFileSync("git", ["checkout", "--", "hello.txt"], { cwd: repo });

  applyUnifiedDiffToRepo(repo, diff);
  const { branch, commitSha } = checkoutNewBranchAndCommitAppliedPatch(repo, {
    issueKey: "MP-17833",
    summary: "Hello change",
    assignee: { emailAddress: "okarsli@example.com" },
    patchText: diff,
  });

  assert.match(branch, /^feat\/okarsli\/MP-17833-/);
  assert.ok(/^[0-9a-f]{7,64}$/i.test(commitSha), "commit hash from git rev-parse");
  const cur = execFileSync("git", ["branch", "--show-current"], { cwd: repo, encoding: "utf8" }).trim();
  assert.equal(cur, branch);
  const content = await fs.readFile(path.join(repo, "hello.txt"), "utf8");
  assert.equal(content.trim(), "v2");
});

test("ensureUniqueLocalBranchName appends suffix when branch exists", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "ios-agent-branch-dup-"));
  execFileSync("git", ["init"], { cwd: repo, encoding: "utf8" });
  execFileSync("git", ["config", "user.email", "test@test.local"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "test"], { cwd: repo });
  await fs.writeFile(path.join(repo, "f.txt"), "a\n", "utf8");
  execFileSync("git", ["add", "f.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repo });
  execFileSync("git", ["branch", "feat/x/MP-1-y"], { cwd: repo });
  const u = ensureUniqueLocalBranchName(repo, "feat/x/MP-1-y");
  assert.equal(u, "feat/x/MP-1-y-2");
});
