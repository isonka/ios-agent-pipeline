export function formatSubtaskDescription(subtask) {
  const changedFilesLines = (subtask.changedFiles || []).map((filePath) => `- ${filePath}`);
  const skillLine = subtask.suggestedSkill ? subtask.suggestedSkill : "none";
  return [
    subtask.body,
    "",
    `Story points: ${subtask.storyPoints}`,
    "Changed files:",
    ...changedFilesLines,
    `Suggested skill: ${skillLine}`,
  ].join("\n");
}
