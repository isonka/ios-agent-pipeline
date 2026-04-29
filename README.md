# iOS Agent Pipeline

New implementation entrypoint: `src/server.js`.

This tool orchestrates manual role handoff using Jira + AWS Bedrock Claude:

Architect -> Developer -> Tester -> Code Reviewer

The pipeline runs against the repository configured in `.env` via `TARGET_PROJECT_PATH`.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy and fill environment values:

```bash
cp .env.example .env
```

Notes:
- `.env.example` defines required keys.
- Startup fails fast if required keys are missing.
- `LLM_PROVIDER` must be `bedrock`.

3. Start:

```bash
npm start
```

## API

### `GET /health`

Simple health endpoint.

### `POST /pipeline/create-subtasks`

Body:

```json
{
  "issueKey": "IOS-123",
  "targetRepoPath": "/absolute/path/to/target/repo"
}
```

Notes:
- `targetRepoPath` is optional; when omitted, `TARGET_PROJECT_PATH` from `.env` is used.

Behavior:
- Loads Jira issue.
- Reads markdown docs from target repo.
- Architect agent builds and stores reusable project memory in `.ios-agent/architect-context.json` (first run).
- Architect agent reuses memory and generates subtask contracts.
- Creates Jira subtasks.
- Optionally moves created subtasks to `JIRA_SUBTASK_TARGET_STATUS`.
- Saves run artifacts in `.data/pipeline-runs/<issue>.json`.

### `POST /pipeline/learn-architect-context`

Body:

```json
{
  "targetRepoPath": "/absolute/path/to/target/repo",
  "forceRegenerate": false
}
```

Behavior:
- Creates architect project memory if it does not exist.
- Reuses existing memory by default.
- If `forceRegenerate=true`, rebuilds memory from docs.

### `POST /pipeline/run-developer`

Body:

```json
{
  "issueKey": "IOS-123",
  "subtaskKey": "IOS-124",
  "targetRepoPath": "/absolute/path/to/target/repo"
}
```

Behavior:
- Developer agent works on one selected subtask.
- Returns `patchProposal` (diff text) for manual apply/review.
- Saves output in run artifact state.

### `POST /pipeline/run-tester`

Body:

```json
{
  "issueKey": "IOS-123",
  "diff": "unified diff text",
  "targetRepoPath": "/absolute/path/to/target/repo"
}
```

Behavior:
- Tester reviews the diff against context and returns `PASS` or `FAIL`.

### `POST /pipeline/run-reviewer`

Body:

```json
{
  "issueKey": "IOS-123",
  "diff": "unified diff text",
  "targetRepoPath": "/absolute/path/to/target/repo"
}
```

Behavior:
- Reviewer consumes diff and tester report and returns merge recommendation.

## Runtime constraints

- Only AWS Bedrock Claude is supported (`LLM_PROVIDER=bedrock`).
- `TARGET_PROJECT_PATH` must point to a readable git repo root.
- Set `JIRA_SUBTASK_TARGET_STATUS` to automatically move new subtasks to a specific Jira status/column.