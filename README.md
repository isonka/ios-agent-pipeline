# iOS Agent Pipeline

`ios-agent-pipeline` is a local orchestration server for Jira-driven iOS delivery using four AI roles:

- Architect
- Developer
- Tester
- Reviewer

Server entrypoint: `src/server.js`

## What It Does

Given a Jira issue, the pipeline coordinates role-based handoff:

1. **Architect**
   - reads the Jira issue (summary + description) and scans the repo for implementation evidence
   - creates actionable Jira subtasks grounded in matched files (no persisted project memory)
2. **Developer**
   - produces implementation plan + patch proposal for one selected subtask
3. **Tester**
   - evaluates a diff and returns PASS/FAIL with test notes
4. **Reviewer**
   - evaluates a diff + tester report and returns merge recommendation

Run artifacts are persisted in `.data/pipeline-runs/<ISSUE_KEY>.json`.

## Requirements

- Node.js 18+
- Jira project access (API token)
- AWS Bedrock access
- Target repository must be a readable git repo root

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and fill required values.

3. Start server:

```bash
npm start
```

Health check:

```bash
curl "http://localhost:3000/health"
```

## Configuration Notes

- `LLM_PROVIDER` must be `bedrock`.
- `TARGET_PROJECT_PATH` is used as default repo path when `targetRepoPath` is not sent in API requests.
- `JIRA_SUBTASK_TARGET_STATUS` is optional; if set, newly created subtasks are moved to that Jira status.
- Startup validation fails fast if required env vars are missing.

## API

All endpoints are JSON over HTTP.

### `GET /health`

Returns basic server status.

### `POST /pipeline/create-subtasks`

Creates architect subtasks for a Jira issue.

Request body:

```json
{
  "issueKey": "IOS-123",
  "targetRepoPath": "/absolute/path/to/target/repo"
}
```

Behavior:
- loads Jira issue
- gathers story-specific implementation evidence from the codebase
- generates 3-6 implementation-ready subtasks linked to real code files
- enforces `storyPoints` between 1 and 3 per subtask
- includes related repo skill guidance (`SKILL.md`) when relevant
- creates subtasks in Jira
- optionally transitions subtasks to `JIRA_SUBTASK_TARGET_STATUS`

### `POST /pipeline/run-developer`

Runs developer role for one subtask.

Request body:

```json
{
  "issueKey": "IOS-123",
  "subtaskKey": "IOS-124",
  "targetRepoPath": "/absolute/path/to/target/repo"
}
```

### `POST /pipeline/run-tester`

Runs tester role for a provided unified diff.

Request body:

```json
{
  "issueKey": "IOS-123",
  "diff": "unified diff text",
  "targetRepoPath": "/absolute/path/to/target/repo"
}
```

### `POST /pipeline/run-reviewer`

Runs reviewer role for a provided unified diff.

Request body:

```json
{
  "issueKey": "IOS-123",
  "diff": "unified diff text",
  "targetRepoPath": "/absolute/path/to/target/repo"
}
```

## Testing

Run tests:

```bash
npm test
```

The suite includes architect-focused tests for:

- JSON parsing and repair behavior
- subtask flow behavior (LLM and deterministic UIKit→SwiftUI paths)