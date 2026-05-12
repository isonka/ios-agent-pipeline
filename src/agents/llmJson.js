/**
 * Shared helpers for agents that expect a single JSON object from Bedrock.
 */

export function extractJsonCandidate(text) {
  if (!text) return "";
  const trimmed = text.trim();

  if (trimmed.startsWith("```")) {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

export function parseJsonResponse(text, failurePrefix) {
  const jsonCandidate = extractJsonCandidate(text);
  try {
    return JSON.parse(jsonCandidate);
  } catch {
    const preview = String(text || "").slice(0, 300).replace(/\s+/g, " ");
    throw new Error(`${failurePrefix}. Preview: ${preview}`);
  }
}

/**
 * First completion parsed as JSON; on failure, one repair pass with strict schema reminder.
 */
export async function generateJsonWithRepair({
  llm,
  systemPrompt,
  userPrompt,
  failurePrefix,
  repairSchemaDescription,
}) {
  const firstText = await llm.generateText({
    systemPrompt,
    userPrompt,
    temperature: 0,
  });

  try {
    return parseJsonResponse(firstText, failurePrefix);
  } catch {
    const repairedText = await llm.generateText({
      systemPrompt,
      userPrompt: [
        "Fix to strict JSON.",
        `SCHEMA ${repairSchemaDescription}`,
        "No prose. No markdown.",
        "INPUT",
        firstText,
      ].join("\n"),
      temperature: 0,
    });
    return parseJsonResponse(repairedText, failurePrefix);
  }
}
