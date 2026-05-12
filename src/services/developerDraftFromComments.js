import { jiraDescriptionPlain } from "../jira/jiraDescriptionPlain.js";
import { extractJsonCandidate } from "../agents/llmJson.js";

/** Machine-readable trailer in developer plan comments (plain text after ADF flattening). */
export const DEVELOPER_DRAFT_MARKER = "<!-- ios-agent-pipeline:developer-draft-json -->";

/**
 * One Jira comment body: human-readable plan + marker + compact JSON for execute step.
 */
export function serializeDeveloperPlanComment({ issueKey, draft }) {
  const payload = {
    implementationPlan: String(draft.implementationPlan || ""),
    riskNotes: String(draft.riskNotes ?? ""),
    testStubs: String(draft.testStubs ?? ""),
  };
  const human = String(draft.implementationPlan || "").trim();
  const jsonLine = JSON.stringify(payload);
  return [
    `Developer **plan** (draft) for ${issueKey}`,
    "",
    human,
    "",
    "_(Approve with a comment containing: `@developer` **plan is approved** **start implementation**)_",
    "",
    DEVELOPER_DRAFT_MARKER,
    jsonLine,
  ].join("\n");
}

/**
 * Newest Jira comment that contains {@link DEVELOPER_DRAFT_MARKER}; parses JSON payload.
 * @returns {{ implementationPlan: string, riskNotes: string, testStubs: string } | null}
 */
export async function fetchLatestDeveloperDraftFromComments(jira, issueKey) {
  const data = await jira.listIssueComments(issueKey);
  const comments = Array.isArray(data?.comments) ? data.comments : [];
  const sorted = [...comments].sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));

  for (const c of sorted) {
    const plain = jiraDescriptionPlain(c.body);
    if (!plain.includes(DEVELOPER_DRAFT_MARKER)) continue;
    const idx = plain.indexOf(DEVELOPER_DRAFT_MARKER);
    const tail = plain.slice(idx + DEVELOPER_DRAFT_MARKER.length).trim();
    let parsed;
    try {
      parsed = JSON.parse(extractJsonCandidate(tail));
    } catch {
      continue;
    }
    if (typeof parsed?.implementationPlan !== "string" || !parsed.implementationPlan.trim()) {
      continue;
    }
    return {
      implementationPlan: parsed.implementationPlan,
      riskNotes: typeof parsed.riskNotes === "string" ? parsed.riskNotes : "",
      testStubs: typeof parsed.testStubs === "string" ? parsed.testStubs : "",
    };
  }

  return null;
}
