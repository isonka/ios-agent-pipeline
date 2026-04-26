import test from "node:test";
import assert from "node:assert/strict";

function makeResponse({ ok = true, status = 200, json = {}, text = "" } = {}) {
  return {
    ok,
    status,
    async json() {
      return json;
    },
    async text() {
      return text;
    },
  };
}

async function importFreshLLMModule() {
  return import(`../config/llm.js?test=${Date.now()}-${Math.random()}`);
}

test("resolveLLMProvider defaults to bedrock", async () => {
  delete process.env.LLM_PROVIDER;
  const llm = await importFreshLLMModule();
  assert.equal(llm.resolveLLMProvider(), "bedrock");
});

test("resolveLLMProvider throws for unsupported provider", async () => {
  process.env.LLM_PROVIDER = "invalid";
  const llm = await importFreshLLMModule();
  assert.throws(() => llm.resolveLLMProvider(), /Unsupported LLM_PROVIDER/);
});

test("callLLM uses OpenAI branch when configured", async () => {
  process.env.LLM_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_MODEL = "gpt-4.1-mini";

  global.fetch = async (url, options) => {
    assert.match(String(url), /api\.openai\.com\/v1\/chat\/completions/);
    assert.equal(options.method, "POST");
    return makeResponse({
      json: {
        choices: [{ message: { content: "{\"ok\":true}" } }],
      },
    });
  };

  const llm = await importFreshLLMModule();
  const result = await llm.callLLM("sys", "user");
  assert.equal(result, "{\"ok\":true}");
});

test("callLLM uses Anthropic branch when configured", async () => {
  process.env.LLM_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";

  global.fetch = async (url, options) => {
    assert.match(String(url), /api\.anthropic\.com\/v1\/messages/);
    assert.equal(options.method, "POST");
    return makeResponse({
      json: {
        content: [{ type: "text", text: "{\"ok\":true}" }],
      },
    });
  };

  const llm = await importFreshLLMModule();
  const result = await llm.callLLM("sys", "user");
  assert.equal(result, "{\"ok\":true}");
});
