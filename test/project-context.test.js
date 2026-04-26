import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function importFreshContextModule() {
  return import(`../project/context.js?test=${Date.now()}-${Math.random()}`);
}

test("buildProjectContext fails when TARGET_PROJECT_PATH is missing", async () => {
  delete process.env.TARGET_PROJECT_PATH;

  const ctx = await importFreshContextModule();
  await assert.rejects(
    () => ctx.buildProjectContext(),
    /Missing TARGET_PROJECT_PATH/
  );
});

test("buildProjectContext fails when mandatory docs are missing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pipeline-context-missing-"));
  process.env.TARGET_PROJECT_PATH = dir;

  const ctx = await importFreshContextModule();
  await assert.rejects(
    () => ctx.buildProjectContext(),
    /Missing mandatory project docs/
  );
});

test("buildProjectContext reads required docs and optional skills", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pipeline-context-ok-"));
  process.env.TARGET_PROJECT_PATH = dir;

  await writeFile(path.join(dir, "README.md"), "Project overview");
  await writeFile(path.join(dir, "CLAUDE.md"), "Project operating rules");

  const skillsDir = path.join(dir, "skills");
  await mkdir(skillsDir);
  await writeFile(path.join(skillsDir, "api-skill.md"), "Skill content");

  const ctx = await importFreshContextModule();
  const result = await ctx.buildProjectContext();

  assert.equal(result.projectPath, dir);
  assert.match(result.requiredDocs.readme, /Project overview/);
  assert.match(result.requiredDocs.claude, /Project operating rules/);
  assert.equal(result.optionalSkills.length, 1);
  assert.equal(result.optionalSkills[0].directory, "skills");
  assert.deepEqual(result.optionalSkills[0].files, ["api-skill.md"]);
});

test("formatProjectContextForPrompt includes skills summary", async () => {
  const ctx = await importFreshContextModule();
  const formatted = ctx.formatProjectContextForPrompt({
    projectPath: "/tmp/sample",
    requiredDocs: {
      readme: "README body",
      claude: "CLAUDE body",
    },
    optionalSkills: [{ directory: "skills", files: ["one.md", "two.md"] }],
  });

  assert.match(formatted, /Project path: \/tmp\/sample/);
  assert.match(formatted, /README body/);
  assert.match(formatted, /CLAUDE body/);
  assert.match(formatted, /skills: one.md, two.md/);
});
