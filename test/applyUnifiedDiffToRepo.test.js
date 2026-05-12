import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { stripDiffMarkdownFences, applyUnifiedDiffToRepo, normalizePatchForGitApply } from "../src/services/applyUnifiedDiffToRepo.js";

test("stripDiffMarkdownFences removes fence", () => {
  assert.equal(stripDiffMarkdownFences("```diff\n--- a/x\n+++ b/x\n@@\n-old\n+new\n```").trim(), "--- a/x\n+++ b/x\n@@\n-old\n+new");
});

test("normalizePatchForGitApply fixes empty lines inside hunks", () => {
  const input = [
    "diff --git a/t.txt b/t.txt",
    "--- a/t.txt",
    "+++ b/t.txt",
    "@@ -1,2 +1,2 @@",
    " a",
    "",
    " b",
    "",
  ].join("\n");
  const out = normalizePatchForGitApply(input);
  assert.match(out, /\n \n b/m, "empty hunk line should become single-space context line");
});

test("normalizePatchForGitApply keeps blank line before next diff --git", () => {
  const input = [
    "diff --git a/a b/a",
    "--- a/a",
    "+++ b/a",
    "@@ -1 +1 @@",
    "-x",
    "+y",
    "",
    "diff --git a/b b/b",
    "--- a/b",
    "+++ b/b",
    "@@ -1 +1 @@",
    "-p",
    "+q",
    "",
  ].join("\n");
  const out = normalizePatchForGitApply(input);
  assert.ok(out.includes("+y\n\ndiff --git"), "separator blank line between files preserved");
});

test("applyUnifiedDiffToRepo applies patch in git repo", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "ios-agent-apply-"));
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
  const out = await fs.readFile(path.join(repo, "hello.txt"), "utf8");
  assert.equal(out.trim(), "v2");
});
