import { callBedrock } from "./llm/providers/bedrock.js";
import { callAnthropic } from "./llm/providers/anthropic.js";
import { callOpenAI } from "./llm/providers/openai.js";
import { getProvider } from "./llm/providers/shared.js";

export function resolveLLMProvider() {
  const provider = getProvider();
  if (!["bedrock", "anthropic", "openai"].includes(provider)) {
    throw new Error(
      `Unsupported LLM_PROVIDER: ${provider}. Use one of: bedrock, anthropic, openai`
    );
  }
  return provider;
}

export async function callLLM(systemPrompt, userMessage) {
  const provider = resolveLLMProvider();
  if (provider === "bedrock") return callBedrock(systemPrompt, userMessage);
  if (provider === "anthropic") return callAnthropic(systemPrompt, userMessage);
  return callOpenAI(systemPrompt, userMessage);
}

// Backward-compatible export used by existing agents.
export async function callClaude(systemPrompt, userMessage) {
  return callLLM(systemPrompt, userMessage);
}
