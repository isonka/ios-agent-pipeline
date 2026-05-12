import { jiraDescriptionPlain } from "../../jira/jiraDescriptionPlain.js";
import { stripAgentFolderLines } from "../agentFolderFromDescription.js";
import { resolveTargetRepoPath } from "../repoPath.js";
import { buildProjectContext } from "../projectContext.js";
import { runDeveloper, runDeveloperPlan, runDeveloperExecute } from "../../agents/developer.js";
import {
  serializeDeveloperPlanComment,
  fetchLatestDeveloperDraftFromComments,
} from "../developerDraftFromComments.js";
import { applyUnifiedDiffToRepo } from "../applyUnifiedDiffToRepo.js";
import { checkoutNewBranchAndCommitAppliedPatch } from "../developerGitBranchCommit.js";

/**
 * Planning text for developer LLM: **Jira description only** (summary + description with Agent folder line stripped).
 * Refined story must live in the issue description (use @architect approved after refine).
 */
export function buildPlanningInputFromIssue(issue) {
  const summary = String(issue?.fields?.summary || "").trim();
  const descPlain = stripAgentFolderLines(jiraDescriptionPlain(issue?.fields?.description)).trim();
  if (!summary && !descPlain) {
    throw new Error(
      "Issue has empty summary and description. Add Jira fields, or run @architect refine then @architect approved to copy the refined story into the description."
    );
  }

  return [
    "Planning input: Jira summary + description (issue description; routing line removed when present).",
    "",
    "**Summary**",
    summary || "(none)",
    "",
    "**Description**",
    descPlain || "(none)",
  ].join("\n");
}

/**
 * Developer plan only: posts one Jira comment (human plan + JSON draft). Next turn: @architect check plan (or POST /pipeline/architect-check-plan).
 */
export async function runDeveloperPlanPipeline({ llm, jira, issueKey, targetRepoPath, targetFallback }) {
  const resolvedRepoPath = await resolveTargetRepoPath(targetRepoPath || "", targetFallback);
  const issue = await jira.getIssue(issueKey);
  const context = await buildProjectContext(resolvedRepoPath);
  const storyScope = buildPlanningInputFromIssue(issue);

  const draft = await runDeveloperPlan({
    llm,
    issue,
    architectPlanText: storyScope,
    context,
  });

  const commentBody = serializeDeveloperPlanComment({ issueKey, draft });
  await jira.addComment(issueKey, commentBody);

  return {
    issueKey,
    targetRepoPath: resolvedRepoPath,
    ...draft,
  };
}

/**
 * After approved plan draft: reads latest developer plan from Jira comments, generates patch, posts implementation comment. No run-state file.
 */
export async function runDeveloperExecutePipeline({
  llm,
  jira,
  issueKey,
  targetRepoPath,
  targetFallback,
}) {
  const resolvedRepoPath = await resolveTargetRepoPath(targetRepoPath || "", targetFallback);
  const issue = await jira.getIssue(issueKey);
  const context = await buildProjectContext(resolvedRepoPath);
  const draft = await fetchLatestDeveloperDraftFromComments(jira, issueKey);
  if (!draft) {
    throw new Error(
      "No developer plan draft in Jira comments (missing pipeline marker). Run POST /pipeline/developer-plan (or @developer plan) first."
    );
  }

  const storyScope = buildPlanningInputFromIssue(issue);

  const executeResult = await runDeveloperExecute({
    llm,
    issue,
    architectPlanText: storyScope,
    developerDraft: draft,
    context,
  });

  const mergedDeveloper = {
    implementationPlan: draft.implementationPlan,
    riskNotes: draft.riskNotes,
    testStubs: draft.testStubs,
    patchProposal: executeResult.patchProposal,
  };

  let applyStatus = "";
  let developerBranch = "";
  let developerCommitSha = "";
  const patchText = mergedDeveloper.patchProposal ? String(mergedDeveloper.patchProposal) : "";
  if (patchText.trim() && process.env.DEVELOPER_SKIP_GIT_APPLY !== "true") {
    try {
      applyUnifiedDiffToRepo(resolvedRepoPath, patchText);
    } catch (applyErr) {
      await jira.addCommentParagraphs(
        issueKey,
        [
          `Developer **implementation** (${issueKey}) — apply failed`,
          "",
          `Patch **not applied** (git apply failed): ${applyErr.message}`,
          "",
          patchText ? "```diff\n" + patchText.slice(0, 12000) + "\n```" : "(no patch text)",
        ].join("\n")
      );
      throw applyErr;
    }
    applyStatus = `Patch **applied** in \`${resolvedRepoPath}\`.`;
    if (process.env.DEVELOPER_SKIP_GIT_COMMIT !== "true") {
      try {
        const gitMeta = checkoutNewBranchAndCommitAppliedPatch(resolvedRepoPath, {
          issueKey,
          summary: issue.fields?.summary || "",
          assignee: issue.fields?.assignee || null,
          patchText,
        });
        developerBranch = gitMeta.branch;
        developerCommitSha = gitMeta.commitSha;
        applyStatus += ` Created branch \`${developerBranch}\`, commit \`${developerCommitSha.slice(0, 12)}\`.`;
      } catch (commitErr) {
        await jira.addCommentParagraphs(
          issueKey,
          [
            `Developer **implementation** (${issueKey}) — git branch/commit failed after apply`,
            "",
            commitErr.message,
            "",
            "Patch may still be present as local changes on the current branch; inspect the repo.",
          ].join("\n")
        );
        throw commitErr;
      }
    } else {
      applyStatus += " Branch/commit skipped (`DEVELOPER_SKIP_GIT_COMMIT=true`).";
    }
  } else if (patchText.trim()) {
    applyStatus = "Patch not applied (`DEVELOPER_SKIP_GIT_APPLY=true`).";
  }

  const successParts = [`Developer **implementation** for ${issueKey}`];
  if (applyStatus) successParts.push(applyStatus);
  successParts.push(mergedDeveloper.implementationPlan || "");
  successParts.push(
    mergedDeveloper.patchProposal
      ? "```diff\n" + String(mergedDeveloper.patchProposal).slice(0, 12000) + "\n```"
      : "(no patchProposal)"
  );
  await jira.addCommentParagraphs(issueKey, successParts.join("\n\n"));

  return {
    issueKey,
    targetRepoPath: resolvedRepoPath,
    developerBranch: developerBranch || undefined,
    developerCommitSha: developerCommitSha || undefined,
    ...mergedDeveloper,
  };
}

/**
 * Single-call developer: one LLM, full JSON. Result only in HTTP response + Jira comment (no run-state).
 */
export async function runDeveloperFullPipeline({
  llm,
  jira,
  issueKey,
  targetRepoPath,
  targetFallback,
}) {
  const resolvedRepoPath = await resolveTargetRepoPath(targetRepoPath || "", targetFallback);
  const issue = await jira.getIssue(issueKey);
  const context = await buildProjectContext(resolvedRepoPath);
  const storyScope = buildPlanningInputFromIssue(issue);

  const developerResult = await runDeveloper({
    llm,
    issue,
    architectPlanText: storyScope,
    context,
  });

  const patchText = developerResult.patchProposal ? String(developerResult.patchProposal) : "";
  let applyStatus = "";
  let developerBranch = "";
  let developerCommitSha = "";
  if (patchText.trim() && process.env.DEVELOPER_SKIP_GIT_APPLY !== "true") {
    try {
      applyUnifiedDiffToRepo(resolvedRepoPath, patchText);
    } catch (applyErr) {
      await jira.addComment(
        issueKey,
        `Developer output for ${issueKey} — git apply failed: ${applyErr.message}\n\n${developerResult.implementationPlan || ""}`
      );
      throw applyErr;
    }
    applyStatus = `\n\nPatch applied: ${resolvedRepoPath}`;
    if (process.env.DEVELOPER_SKIP_GIT_COMMIT !== "true") {
      try {
        const gitMeta = checkoutNewBranchAndCommitAppliedPatch(resolvedRepoPath, {
          issueKey,
          summary: issue.fields?.summary || "",
          assignee: issue.fields?.assignee || null,
          patchText,
        });
        developerBranch = gitMeta.branch;
        developerCommitSha = gitMeta.commitSha;
        applyStatus += `\nBranch \`${developerBranch}\`, commit \`${developerCommitSha.slice(0, 12)}\`.`;
      } catch (commitErr) {
        await jira.addComment(
          issueKey,
          `Developer output for ${issueKey} — git branch/commit failed after apply: ${commitErr.message}\n\n${developerResult.implementationPlan || ""}`
        );
        throw commitErr;
      }
    } else {
      applyStatus += "\nBranch/commit skipped (DEVELOPER_SKIP_GIT_COMMIT=true).";
    }
  } else if (patchText.trim()) {
    applyStatus = "\n\n(Patch not applied: DEVELOPER_SKIP_GIT_APPLY=true)";
  }

  await jira.addComment(
    issueKey,
    `Developer output for ${issueKey}.${applyStatus}\n\n${developerResult.implementationPlan || ""}`
  );

  return {
    issueKey,
    targetRepoPath: resolvedRepoPath,
    developerBranch: developerBranch || undefined,
    developerCommitSha: developerCommitSha || undefined,
    ...developerResult,
  };
}
