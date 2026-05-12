import test from "node:test";
import assert from "node:assert/strict";

import { buildPlanningInputFromIssue } from "../src/services/pipeline/developerStages.js";

test("buildPlanningInputFromIssue uses summary and description", () => {
  const text = buildPlanningInputFromIssue({
    fields: { summary: "My story", description: "Acceptance: done when green." },
  });
  assert.match(text, /My story/);
  assert.match(text, /Acceptance/);
});

test("buildPlanningInputFromIssue strips Agent folder from description", () => {
  const text = buildPlanningInputFromIssue({
    fields: {
      summary: "S",
      description: "Agent folder: Features/Auth\n\nBody only here.",
    },
  });
  assert.match(text, /Body only here/);
  assert.doesNotMatch(text, /Agent folder/i);
});

test("buildPlanningInputFromIssue throws when empty", () => {
  assert.throws(
    () => buildPlanningInputFromIssue({ fields: { summary: "", description: null } }),
    /empty summary and description/
  );
});
