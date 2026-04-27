import { callClaude } from "../config/llm.js";
import { parseModelJson } from "../utils/llmJson.js";
import { formatAgentMemoryForPrompt, loadAgentMemory } from "../project/agentMemory.js";

const SYSTEM_PROMPT = `iOS QA. Test issue against PR diff. Be thorough. No fluff.

Rules:
- No filler. Flag every bug. Think: will this break in prod?
- Code blocks normal. Technical terms exact.
- Flag: force unwraps, missing error handling, threading issues, memory leaks.
- If snapshot tests are missing, provide snapshot test code to add.
- Simulator baseline: Marktplaats iPhone 14 Pro, iOS 18.2.
- Perform manual behavior validation of new implementation.
- Assess integration test coverage and whether integration tests are passing.

JSON only. No fences. No preamble:
{
  "testPlan": "markdown. Happy path, edge cases, error states, perf.",
  "snapshotTests": "XCTest snapshot test code or additions when missing.",
  "manualValidation": {
    "worksAsExpected": true,
    "stepsRun": ["manual step"],
    "observations": ["observation"]
  },
  "integrationTests": {
    "status": "PASS|FAIL|NOT_AVAILABLE",
    "details": "what integration tests were considered"
  },
  "unitTests": "complete XCTest impl for all key logic.",
  "uiTests": "XCUITest steps for all user flows.",
  "bugsFound": ["bug"],
  "coverageAssessment": "covered vs missing",
  "verdict": "PASS|CONDITIONAL_PASS|FAIL",
  "verdictReason": "why"
}`;

/**
 * Tester agent — reviews issue + PR diff and produces test plan.
 * @param {object} issue   Gitea issue object
 * @param {string} diff    PR diff as plain text
 * @returns {Promise<{testPlan, snapshotTests, manualValidation, integrationTests, unitTests, uiTests, bugsFound, coverageAssessment, verdict, verdictReason}>}
 */
export async function runTester(issue, diff, deps = {}) {
  const llmCall = deps.llmCall || callClaude;
  const getMemory = deps.getMemory || (() => loadAgentMemory("tester"));
  const issueId = issue.key || issue.number || "UNKNOWN";
  const title = issue.title || issue.fields?.summary || "Untitled";
  const body = issue.body || issue.fields?.description || "";
  const memory = await getMemory();
  const memoryForPrompt = formatAgentMemoryForPrompt(memory);
  const userMessage = `Test. iOS.

#${issueId}: ${title}
${body}

Diff:
${diff || "No diff."}

Tester memory (learned expectations):
${memoryForPrompt}

Required output quality gate:
- If manual behavior does not work as expected, set verdict FAIL.
- If critical integration tests fail, set verdict FAIL.`;

  const raw = await llmCall(SYSTEM_PROMPT, userMessage);
  return parseModelJson(raw, "Tester");
}