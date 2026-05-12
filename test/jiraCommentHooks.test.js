import test from "node:test";
import assert from "node:assert/strict";

import { resolveJiraCommentHook } from "../src/agents/jiraCommentHooks.js";

test("resolveJiraCommentHook architect refine", () => {
  assert.equal(resolveJiraCommentHook("@architect refine this story"), "architect_refine");
  assert.equal(resolveJiraCommentHook("Please @architect refine"), "architect_refine");
});

test("resolveJiraCommentHook developer plan", () => {
  assert.equal(resolveJiraCommentHook("@developer plan story"), "developer_plan");
  assert.equal(resolveJiraCommentHook("@developer plan the work"), "developer_plan");
});

test("resolveJiraCommentHook developer execute wins over generic plan", () => {
  assert.equal(
    resolveJiraCommentHook("@developer plan is approved. Start implementation"),
    "developer_execute"
  );
  assert.equal(
    resolveJiraCommentHook("@developer plan was approved\n\nstart implementation"),
    "developer_execute"
  );
});

test("resolveJiraCommentHook ignores bare @developer", () => {
  assert.equal(resolveJiraCommentHook("@developer hello"), null);
});

test("resolveJiraCommentHook architect wins over @developer in same text", () => {
  assert.equal(resolveJiraCommentHook("@architect refine\n@developer plan"), "architect_refine");
});

test("resolveJiraCommentHook architect approved", () => {
  assert.equal(resolveJiraCommentHook("@architect approved"), "architect_approved");
  assert.equal(resolveJiraCommentHook("Please @architect approved"), "architect_approved");
});

test("resolveJiraCommentHook refine wins when both refine and approved words appear", () => {
  assert.equal(resolveJiraCommentHook("@architect refine then approved later"), "architect_refine");
});
