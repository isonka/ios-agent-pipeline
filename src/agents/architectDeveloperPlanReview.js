import { generateJsonWithRepair } from "./llmJson.js";

const SYSTEM_PROMPT =
  "You are an iOS Architect. You review a proposed developer implementation plan against the user story. Output only valid JSON.";

const REVIEW_SCHEMA =
  '{"decision":"approve","reason":"string"} where decision is exactly approve or reject (lowercase); reason is one short paragraph.';

function buildReviewUserPrompt({ issue, storyScope, developerDraft }) {
  return [
    `ISSUE ${issue.key}: ${issue.fields?.summary || ""}`,
    "",
    "STORY_SCOPE",
    storyScope,
    "",
    "PROPOSED_DEVELOPER_PLAN",
    "**implementationPlan**",
    String(developerDraft.implementationPlan || ""),
    "",
    "**riskNotes**",
    String(developerDraft.riskNotes ?? ""),
    "",
    "**testStubs**",
    String(developerDraft.testStubs ?? ""),
    "",
    "TASK",
    "Decide whether this plan is acceptable to proceed to implementation (approve) or needs revision (reject).",
    "Approve only if the plan matches the story scope, is technically plausible, and risks are tolerable.",
    `SCHEMA ${REVIEW_SCHEMA}`,
    "JSON only.",
  ].join("\n");
}

/**
 * @returns {{ decision: "approve" | "reject", reason: string }}
 */
export async function runArchitectReviewDeveloperPlan({ llm, issue, storyScope, developerDraft }) {
  const parsed = await generateJsonWithRepair({
    llm,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildReviewUserPrompt({ issue, storyScope, developerDraft }),
    failurePrefix: "Architect plan review returned non-JSON content",
    repairSchemaDescription: REVIEW_SCHEMA,
  });

  const decision = String(parsed?.decision || "").toLowerCase();
  if (decision !== "approve" && decision !== "reject") {
    throw new Error(`Architect review has invalid decision: ${parsed?.decision}`);
  }

  return {
    decision,
    reason: typeof parsed?.reason === "string" ? parsed.reason : "",
  };
}
