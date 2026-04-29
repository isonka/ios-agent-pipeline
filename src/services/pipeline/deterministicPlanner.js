import { issueSummary } from "./moduleResolution.js";

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean))];
}

function selectPaths(matches, predicate) {
  return uniquePaths(matches.map((item) => item.path).filter((path) => predicate(path)));
}

export function buildUIKitToSwiftUISubtasks(issue, implementationContext, resolvedModule) {
  const matches = resolvedModule.primary.matches;
  const allPaths = uniquePaths(matches.map((item) => item.path));
  const uikitIntegrationPaths = selectPaths(
    matches,
    (path) =>
      path.includes("ViewController") ||
      path.includes("SceneBuilder") ||
      path.includes("Adapter") ||
      path.includes("Router") ||
      path.includes("Cell")
  );
  const stateFiles = selectPaths(
    matches,
    (path) => path.includes("ViewState") || path.includes("State") || path.includes("Item") || path.includes("Converter")
  );
  const swiftUIViewPaths = selectPaths(
    matches,
    (path) =>
      path.includes("/View/") &&
      path.endsWith(".swift") &&
      !path.includes("ViewController") &&
      !path.includes("Cell")
  );
  const testPaths = selectPaths(matches, (path) => path.includes("/Tests/") || path.includes("SnapshotTests"));
  const generatedStringFiles = selectPaths(matches, (path) => path.includes("Generated/Strings") || path.includes("SwiftGen-Strings"));
  const skillDocs = implementationContext.skillDocs || [];
  const migrationSkill =
    skillDocs.find((path) => path.toLowerCase().includes("uikit-to-swiftui")) || null;

  const integrationFiles = uikitIntegrationPaths.length
    ? uikitIntegrationPaths.slice(0, 3)
    : allPaths.slice(0, 3);
  const stateMappingFiles = stateFiles.length ? stateFiles.slice(0, 3) : integrationFiles.slice(0, 2);
  const swiftFiles = swiftUIViewPaths.length ? swiftUIViewPaths.slice(0, 3) : allPaths.slice(0, 3);
  const verificationFiles = uniquePaths([...testPaths, ...generatedStringFiles, ...swiftFiles]).slice(0, 3);

  const featureLabel = issueSummary(issue) || issue.key;
  const moduleLabel = resolvedModule.primary.moduleName;

  const subtasks = [
    {
      title: `Remove UIKit composition for ${featureLabel} in ${moduleLabel}`,
      body:
        [
          `Primary module resolved by architect: ${moduleLabel}.`,
          "Remove UIKit-specific composition logic in the listed integration files.",
          "Delete or replace code paths that instantiate UIKit containers/cells/controllers only for this feature.",
          "Acceptance:",
          "- SwiftUI composition path is used for this feature",
          "- no feature-specific UIKit composition branch remains in listed integration files",
        ].join("\n"),
      storyPoints: 3,
      changedFiles: integrationFiles,
      suggestedSkill: migrationSkill,
    },
    {
      title: `Update state-to-view mapping for ${featureLabel}`,
      body:
        [
          "Update mapping/converter/state item files so feature state feeds SwiftUI view models directly.",
          "Remove mapping assumptions that only exist for UIKit rendering path.",
          "Acceptance:",
          "- mapping compiles with SwiftUI model contract",
          "- rendered content remains equivalent for title/value/list states",
        ].join("\n"),
      storyPoints: 2,
      changedFiles: stateMappingFiles,
      suggestedSkill: migrationSkill,
    },
    {
      title: `Finalize SwiftUI feature view behavior for ${featureLabel}`,
      body:
        [
          "Refine SwiftUI view files for this feature and preserve interaction/analytics parity.",
          "Remove any remaining code that exists only to support previous UIKit hosting behavior.",
          "Acceptance:",
          "- user interactions behave same as before migration",
          "- analytics semantics remain equivalent",
        ].join("\n"),
      storyPoints: 2,
      changedFiles: swiftFiles,
      suggestedSkill: migrationSkill,
    },
    {
      title: `Add or update migration tests for ${featureLabel}`,
      body:
        [
          "Add focused tests for migrated feature flow in resolved module.",
          "Acceptance:",
          "- tests cover migrated composition path after UIKit removal",
          "- tests cover core SwiftUI interactions/regressions",
        ].join("\n"),
      storyPoints: 2,
      changedFiles: verificationFiles.length ? verificationFiles : swiftFiles.slice(0, 2),
      suggestedSkill: null,
    },
  ].filter((item) => Array.isArray(item.changedFiles) && item.changedFiles.length > 0);

  return {
    summary: `Architect used module-resolved UIKit->SwiftUI planning for ${issue.key} (${moduleLabel}).`,
    subtasks,
    moduleResolution: {
      primaryModule: moduleLabel,
      confidence: resolvedModule.confidence,
      reason: resolvedModule.reason,
    },
    generatedBy: "deterministic-uikit-swiftui",
  };
}
