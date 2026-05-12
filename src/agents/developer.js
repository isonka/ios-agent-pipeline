import { jiraDescriptionPlain } from "../jira/jiraDescriptionPlain.js";

function buildDeveloperPrompt({ issue, architectPlanText, context }) {
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
    'SCHEMA {"implementationPlan":"short plan","patchProposal":"unified diff patch text only","riskNotes":"main risks","testStubs":"tests developer expects to add/run"}',
    "JSON only.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runDeveloper({ llm, issue, architectPlanText, context }) {
  const text = await llm.generateText({
    systemPrompt: "You are a Senior iOS Developer agent. Output only valid JSON.",
    userPrompt: buildDeveloperPrompt({ issue, architectPlanText, context }),
    temperature: 0,
  });

  return JSON.parse(text);
}
