import { callClaude } from "../config/llm.js";
import { getProjectContextForPromptCached } from "../project/context.js";

const SYSTEM_PROMPT = `Senior iOS dev. Implement task from Jira spec + project context.

Rules:
- No filler. No pleasantries. Direct.
- Code blocks normal. Technical terms exact.
- Swift 6.2+. async/await. SwiftUI where fit.
- First check optional skills from project context.
- If relevant skill exists, apply it strictly.
- If no relevant skill exists, implement directly using existing modules/patterns in project docs as examples.
- Never block on missing skills.

JSON only. No fences. No preamble:
{
  "implementationPlan": "markdown. Full Swift impl. File names, code, SPM deps, inline comments.",
  "prTitle": "short PR title",
  "prDescription": "what changed, how to test, closes #ISSUE_NUMBER",
  "branchName": "feature/issue-{number}-slug",
  "testStubs": "XCTest skeleton. Method names + assertions.",
  "developerDecision": {
    "usedSkill": true,
    "skillFilesUsed": ["skills/example-skill.md"],
    "fallbackUsed": false,
    "reason": "why skill or fallback was chosen"
  }
}`;

/**
 * Developer agent — produces implementation plan for a subtask.
 * Stateless: only reads the issue body.
 * @param {object} issue  Gitea issue object
 * @returns {Promise<{implementationPlan, prTitle, prDescription, branchName, testStubs, developerDecision}>}
 */
export async function runDeveloper(issue, deps = {}) {
  const llmCall = deps.llmCall || callClaude;
  const getProjectContext = deps.getProjectContext || getProjectContextForPromptCached;
  const issueId = issue.key || issue.number || "UNKNOWN";
  const title = issue.title || issue.fields?.summary || "Untitled";
  const body = issue.body || issue.fields?.description || "No description.";
  const projectContext = await getProjectContext();
  const userMessage = `Implement. iOS.

#${issueId}: ${title}

${body}

Project context:
${projectContext}

Execution policy:
- Use project skills when relevant.
- If no relevant skill, implement via existing module examples from project docs.
- Deliver concrete file-level implementation plan with no interpretation gaps.`;

  const raw = await llmCall(SYSTEM_PROMPT, userMessage);

  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    throw new Error(`Developer returned invalid JSON:\n${raw}`);
  }
}