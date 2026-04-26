export function getMaxTokens() {
  return Number(process.env.LLM_MAX_TOKENS || 4096);
}

export function getProvider() {
  return (process.env.LLM_PROVIDER || "bedrock").toLowerCase();
}
