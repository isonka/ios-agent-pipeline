import { callClaude } from "../config/llm.js";
import { parseModelJson } from "../utils/llmJson.js";

const SYSTEM_PROMPT = `Principal iOS engineer. Final PR review. Approve only if prod-ready.

Rules:
- No filler. Direct verdict. Opinionated.
- Flag: force unwraps, memory leaks, missing error handling, threading issues, hardcoded values.
- Code blocks normal. Technical terms exact.
- Reviewer must make merge gate explicit.

JSON only. No fences. No preamble:
{
  "verdict": "APPROVE|REQUEST_CHANGES",
  "summary": "3-5 sentence assessment",
  "feedback": "specific required changes. empty string if APPROVE.",
  "codeQuality": "EXCELLENT|GOOD|ACCEPTABLE|POOR",
  "securityConcerns": ["concern"],
  "performanceConcerns": ["concern"],
  "suggestions": ["optional improvement"],
  "reviewerDecision": {
    "mergeReady": true,
    "blockingIssues": ["issue"],
    "requiredChecks": {
      "manualValidationVerified": true,
      "integrationTestsVerified": true
    }
  }
}`;

/**
 * PR Reviewer agent — final gate before merge.
 * @param {object} pr        Gitea PR object
 * @param {string} diff      PR diff
 * @param {Array}  comments  Existing PR comments (includes tester output)
 * @returns {Promise<{verdict, summary, feedback, reviewerDecision, ...}>}
 */
export async function runPRReviewer(pr, diff, comments, deps = {}) {
  const llmCall = deps.llmCall || callClaude;
  const testerComment = comments
    .filter((c) => c.body?.includes("🧪 Tester Agent"))
    .map((c) => c.body)
    .join("\n\n");

  const userMessage = `Review. iOS PR.

#${pr.number}: ${pr.title}
${pr.body || ""}

QA:
${testerComment || "No QA."}

Diff:
${diff || "No diff."}

Quality gate:
- If merge is not safe, verdict must be REQUEST_CHANGES and mergeReady false.`;

  const raw = await llmCall(SYSTEM_PROMPT, userMessage);
  return parseModelJson(raw, "PR Reviewer");
}