import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  getSimulatorDestination,
  ensureSnapshotTestExists,
  runIOSTests,
  ensureSnapshotsAndRunTests,
} from "../project/testRunner.js";

test("getSimulatorDestination uses configured defaults", () => {
  delete process.env.IOS_SIMULATOR_NAME;
  delete process.env.IOS_SIMULATOR_OS;
  const destination = getSimulatorDestination();
  assert.match(destination, /name=Marktplaats iPhone 14 Pro/);
  assert.match(destination, /OS=18\.2/);
});

test("ensureSnapshotTestExists creates file when no snapshot exists", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "snapshot-create-"));
  await mkdir(path.join(dir, "Tests"), { recursive: true });
  await writeFile(path.join(dir, "Tests", "SampleTests.swift"), "import XCTest");

  const result = await ensureSnapshotTestExists(dir, "MP-99");
  assert.equal(result.created, true);
  assert.match(result.path, /GeneratedSnapshotTests\.swift$/);
});

test("ensureSnapshotTestExists skips when snapshot file exists", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "snapshot-skip-"));
  await mkdir(path.join(dir, "Tests"), { recursive: true });
  await writeFile(path.join(dir, "Tests", "LoginSnapshotTests.swift"), "import XCTest");

  const result = await ensureSnapshotTestExists(dir, "MP-100");
  assert.equal(result.created, false);
  assert.equal(result.path, null);
});

test("runIOSTests builds xcodebuild args using workspace detection", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "xcodebuild-args-"));
  await mkdir(path.join(dir, "App.xcworkspace"));
  process.env.IOS_TEST_SCHEME = "AppScheme";
  delete process.env.IOS_WORKSPACE;
  delete process.env.IOS_PROJECT;

  let captured = null;
  await runIOSTests(dir, {
    executeCommand: async (cwd, args) => {
      captured = { cwd, args };
      return { success: true, exitCode: 0, outputTail: "ok" };
    },
  });

  assert.equal(captured.cwd, dir);
  assert.deepEqual(captured.args.slice(0, 2), ["-workspace", "App.xcworkspace"]);
  assert.match(captured.args.join(" "), /-scheme AppScheme/);
  assert.match(captured.args.join(" "), /test$/);
});

test("ensureSnapshotsAndRunTests returns execution summary", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "run-summary-"));
  process.env.TARGET_PROJECT_PATH = dir;
  process.env.IOS_TEST_SCHEME = "AppScheme";
  process.env.IOS_WORKSPACE = "App.xcworkspace";
  await mkdir(path.join(dir, "Tests"), { recursive: true });

  const result = await ensureSnapshotsAndRunTests("MP-7", {
    executeCommand: async () => ({ success: true, exitCode: 0, outputTail: "done" }),
  });

  assert.equal(result.testRun.success, true);
  assert.match(result.destination, /platform=iOS Simulator/);
});
