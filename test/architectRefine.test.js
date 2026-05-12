import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { jiraDescriptionPlain } from "../src/jira/jiraDescriptionPlain.js";
import { extractAgentFolderRelPath, stripAgentFolderLines } from "../src/services/agentFolderFromDescription.js";
import { loadClaudeMdFromRepoFolder } from "../src/services/claudeMdLoader.js";
import {
  shouldTriggerArchitectRefineFromComment,
  refineStoryFromClaudeMd,
} from "../src/agents/architectRefineStory.js";

test("jiraDescriptionPlain reads ADF text nodes", () => {
  const adf = {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Agent folder: Features/Auth" }],
      },
    ],
  };
  assert.equal(jiraDescriptionPlain(adf), "Hello world\nAgent folder: Features/Auth");
});

test("extractAgentFolderRelPath finds line", () => {
  const plain = "Intro line\nAgent folder: Modules/Payment\nOther";
  assert.equal(extractAgentFolderRelPath(plain), "Modules/Payment");
});

test("extractAgentFolderRelPath is case insensitive", () => {
  assert.equal(extractAgentFolderRelPath("AGENT FOLDER: foo/bar"), "foo/bar");
});

test("shouldTriggerArchitectRefineFromComment requires @architect and refine word", () => {
  assert.equal(shouldTriggerArchitectRefineFromComment("@architect refine this story"), true);
  assert.equal(shouldTriggerArchitectRefineFromComment("@Architect please refine"), true);
  assert.equal(shouldTriggerArchitectRefineFromComment("@architect do work"), false);
  assert.equal(shouldTriggerArchitectRefineFromComment("refine only"), false);
});

test("loadClaudeMdFromRepoFolder reads claude.md", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "iap-refine-"));
  await fs.mkdir(path.join(root, "Feature", "X"), { recursive: true });
  await fs.writeFile(path.join(root, "Feature", "X", "claude.md"), "# ctx\n", "utf8");
  await fs.mkdir(path.join(root, ".git"), { recursive: true });

  const out = await loadClaudeMdFromRepoFolder({ repoRoot: root, folderRel: "Feature/X" });
  assert.equal(out.content, "# ctx\n");
  assert.match(out.claudeRelativePath, /Feature\/X\/claude\.md/);

  await fs.rm(root, { recursive: true, force: true });
});

test("loadClaudeMdFromRepoFolder rejects traversal", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "iap-refine2-"));
  await fs.mkdir(path.join(root, ".git"), { recursive: true });

  await assert.rejects(
    () => loadClaudeMdFromRepoFolder({ repoRoot: root, folderRel: "../etc" }),
    /Invalid Agent folder/
  );

  await fs.rm(root, { recursive: true, force: true });
});

test("stripAgentFolderLines removes routing line", () => {
  const plain = "Goal text\nAgent folder: Mod/Foo\nMore body";
  assert.equal(stripAgentFolderLines(plain), "Goal text\nMore body");
});

test("refineStoryFromClaudeMd calls llm", async () => {
  let receivedUser = "";
  const llm = {
    async generateText({ userPrompt }) {
      receivedUser = userPrompt;
      return "Refined output";
    },
  };
  const text = await refineStoryFromClaudeMd({
    llm,
    issueSummary: "S",
    issueDescriptionPlain: "Do the thing",
    claudeMdContent: "rules",
  });
  assert.equal(text, "Refined output");
  assert.match(receivedUser, /STORY/);
  assert.match(receivedUser, /CONTEXT/);
  assert.match(receivedUser, /Do the thing/);
  assert.match(receivedUser, /rules/);
});
