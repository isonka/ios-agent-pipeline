import test from "node:test";
import assert from "node:assert/strict";

import { extractJsonCandidate, parseJsonResponse, generateJsonWithRepair } from "../src/agents/llmJson.js";

test("extractJsonCandidate strips markdown fence", () => {
  const inner = '{"a":1}';
  assert.equal(extractJsonCandidate(`Here is JSON:\n\`\`\`json\n${inner}\n\`\`\``), inner);
});

test("extractJsonCandidate slices first object", () => {
  const text = 'prefix {"x":true} trailing';
  assert.equal(extractJsonCandidate(text), '{"x":true}');
});

test("parseJsonResponse parses fenced content", () => {
  const obj = parseJsonResponse("```json\n{\"k\":\"v\"}\n```", "fail");
  assert.deepEqual(obj, { k: "v" });
});

test("generateJsonWithRepair succeeds on first fenced response", async () => {
  const llm = {
    async generateText() {
      return "```json\n{\"ok\":true}\n```";
    },
  };
  const out = await generateJsonWithRepair({
    llm,
    systemPrompt: "sys",
    userPrompt: "user",
    failurePrefix: "x",
    repairSchemaDescription: "{}",
  });
  assert.deepEqual(out, { ok: true });
});

test("generateJsonWithRepair uses repair pass", async () => {
  let n = 0;
  const llm = {
    async generateText({ userPrompt }) {
      n += 1;
      if (n === 1) return "not json";
      assert.match(userPrompt, /Fix to strict JSON/);
      return '{"fixed":1}';
    },
  };
  const out = await generateJsonWithRepair({
    llm,
    systemPrompt: "sys",
    userPrompt: "user",
    failurePrefix: "bad",
    repairSchemaDescription: '{"fixed":number}',
  });
  assert.deepEqual(out, { fixed: 1 });
  assert.equal(n, 2);
});
