import { jiraDescriptionPlain } from "../jira/jiraDescriptionPlain.js";
import { generateJsonWithRepair } from "./llmJson.js";

const DEVELOPER_SYSTEM_PROMPT = "You are a Senior iOS Developer agent. Output only valid JSON.";

const DEVELOPER_FULL_SCHEMA =
  '{"implementationPlan":"short plan","patchProposal":"unified diff patch text only","riskNotes":"main risks","testStubs":"tests developer expects to add/run"}';

const DEVELOPER_PLAN_SCHEMA =
  '{"implementationPlan":"short plan","riskNotes":"main risks","testStubs":"tests developer expects to add/run"}';

const DEVELOPER_EXECUTE_SCHEMA = '{"patchProposal":"unified diff patch text only"}';

function buildDeveloperBaseParts({ issue, architectPlanText, context }) {
  const description = jiraDescriptionPlain(issue.fields?.description).slice(0, 8000);
  return [
    `ISSUE ${issue.key}: ${issue.fields?.summary || ""}`,
    description ? `DESCRIPTION\n${description}` : "",
    "",
    "ARCHITECT_PLAN",
    architectPlanText,
    "",
    "DOCS",
    ...context.docs.map((doc) => `--- ${doc.path}\n${doc.content}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDeveloperFullPrompt(params) {
  return [
    buildDeveloperBaseParts(params),
    "",
    `SCHEMA ${DEVELOPER_FULL_SCHEMA}`,
    "JSON only.",
  ].join("\n");
}

function buildDeveloperPlanPrompt(params) {
  return [
    buildDeveloperBaseParts(params),
    "",
    "TASK: Produce an implementation plan only. Do not output a code patch yet.",
    `SCHEMA ${DEVELOPER_PLAN_SCHEMA}`,
    "JSON only.",
  ].join("\n");
}

function buildDeveloperExecutePrompt({ issue, architectPlanText, developerDraft, context }) {
  const draftBlock = [
    "APPROVED_DEVELOPER_PLAN",
    `implementationPlan:\n${developerDraft.implementationPlan || ""}`,
    "",
    `riskNotes:\n${developerDraft.riskNotes || ""}`,
    "",
    `testStubs:\n${developerDraft.testStubs || ""}`,
  ].join("\n");

  return [
    buildDeveloperBaseParts({ issue, architectPlanText, context }),
    "",
    draftBlock,
    "",
    "TASK: The plan above was approved. Output only a unified diff patch that implements it.",
    `SCHEMA ${DEVELOPER_EXECUTE_SCHEMA}`,
    "JSON only.",
  ].join("\n");
}

export async function runDeveloperPlan({ llm, issue, architectPlanText, context }) {
  const parsed = await generateJsonWithRepair({
    llm,
    systemPrompt: DEVELOPER_SYSTEM_PROMPT,
    userPrompt: buildDeveloperPlanPrompt({ issue, architectPlanText, context }),
    failurePrefix: "Developer plan returned non-JSON content",
    repairSchemaDescription: DEVELOPER_PLAN_SCHEMA,
  });

  if (typeof parsed?.implementationPlan !== "string") {
    throw new Error("Developer plan output missing implementationPlan string.");
  }

  return {
    implementationPlan: parsed.implementationPlan,
    riskNotes: typeof parsed.riskNotes === "string" ? parsed.riskNotes : "",
    testStubs: typeof parsed.testStubs === "string" ? parsed.testStubs : "",
  };
}

export async function runDeveloperExecute({ llm, issue, architectPlanText, developerDraft, context }) {
  const parsed = await generateJsonWithRepair({
    llm,
    systemPrompt: DEVELOPER_SYSTEM_PROMPT,
    userPrompt: buildDeveloperExecutePrompt({ issue, architectPlanText, developerDraft, context }),
    failurePrefix: "Developer execute returned non-JSON content",
    repairSchemaDescription: DEVELOPER_EXECUTE_SCHEMA,
  });

  if (typeof parsed?.patchProposal !== "string") {
    throw new Error("Developer execute output missing patchProposal string.");
  }

  return { patchProposal: parsed.patchProposal };
}

/** One LLM call: full developer JSON (plan + patch + notes). */
export async function runDeveloper({ llm, issue, architectPlanText, context }) {
  const parsed = await generateJsonWithRepair({
    llm,
    systemPrompt: DEVELOPER_SYSTEM_PROMPT,
    userPrompt: buildDeveloperFullPrompt({ issue, architectPlanText, context }),
    failurePrefix: "Developer returned non-JSON content",
    repairSchemaDescription: DEVELOPER_FULL_SCHEMA,
  });

  if (typeof parsed?.implementationPlan !== "string") {
    throw new Error("Developer output missing implementationPlan string.");
  }

  return parsed;
}
