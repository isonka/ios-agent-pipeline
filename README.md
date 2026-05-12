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
   - posts a structured plan as a Jira comment on that issue and saves `planItems` in run state (no Sub-task issues)
2. **Developer**
   - produces implementation plan + patch proposal for the story, using the architect plan stored for that issue
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
- Startup validation fails fast if required env vars are missing.

### What does *not* trigger this service

This app **does not** listen to Jira for new comments on its own. **Outgoing** comments (architect plan, developer output, etc.) are normal Jira activity and **do not** call your pipeline.

Pipeline steps run only when **you** call the HTTP API (for example `curl` / Postman) or when **Jira Automation** (or another client) sends an HTTP request to your server—for example `POST /hooks/jira/comment` if you configure that rule later.

## API

All endpoints are JSON over HTTP.

### `GET /health`

Returns basic server status.

### `POST /pipeline/create-subtasks`

Runs the **architect on the parent Jira issue** (no Sub-task issues). Posts **one** comment on that issue with the structured plan (summary + numbered items). Saves `planItems` under `.data/pipeline-runs/<ISSUE_KEY>.json` for the developer step.

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
- produces a plan (LLM JSON `subtasks` internally, exposed as `planItems` without Jira keys)
- comments the plan on the **same** issue
- persists `architect.planItems` in run state for `POST /pipeline/run-developer`

### `POST /pipeline/run-developer`

Runs the developer for the **story** (`issueKey` only). Uses the latest architect `planItems` from run state plus repo docs context.

Request body:

```json
{
  "issueKey": "IOS-123",
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
- architect plan flow (LLM and deterministic UIKit→SwiftUI paths)