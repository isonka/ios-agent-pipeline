function normalizePath(pathValue) {
  return String(pathValue || "").trim().toLowerCase();
}

export function mergeImplementationSignals(existingMemoryContent, implementationContext, issueKey) {
  const existingSignals = Array.isArray(existingMemoryContent?.implementationSignals)
    ? existingMemoryContent.implementationSignals
    : [];
  const existingPaths = new Set(existingSignals.map((item) => normalizePath(item.path)));

  const newSignals = [];
  for (const match of implementationContext.matches || []) {
    const normalizedPath = normalizePath(match.path);
    if (!normalizedPath || existingPaths.has(normalizedPath)) continue;
    existingPaths.add(normalizedPath);
    newSignals.push({
      path: match.path,
      reason: match.reason,
      learnedFromIssue: issueKey,
      learnedAt: new Date().toISOString(),
    });
  }

  if (!newSignals.length) {
    return {
      mergedContent: existingMemoryContent,
      updated: false,
      addedSignals: 0,
    };
  }

  return {
    mergedContent: {
      ...existingMemoryContent,
      implementationSignals: [...existingSignals, ...newSignals],
    },
    updated: true,
    addedSignals: newSignals.length,
  };
}
