function tryParse(jsonText) {
  return JSON.parse(jsonText);
}

function extractFromCodeFence(raw) {
  const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
  return fenceMatch ? fenceMatch[1].trim() : null;
}

function extractByBraces(raw) {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return raw.slice(first, last + 1).trim();
}

export function parseModelJson(raw, agentName) {
  const trimmed = String(raw || "").trim();
  const candidates = [
    trimmed,
    trimmed.replace(/```json|```/gi, "").trim(),
    extractFromCodeFence(trimmed),
    extractByBraces(trimmed),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return tryParse(candidate);
    } catch {
      // keep trying
    }
  }

  throw new Error(`${agentName} returned invalid JSON:\n${raw}`);
}
