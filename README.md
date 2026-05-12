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
   - **Two-step (recommended):** `POST /pipeline/developer-plan` saves a draft (`developerDraft` in run state) and comments the plan; after human approval, `POST /pipeline/developer-execute` generates the patch and clears the draft.
   - **One-shot (legacy):** `POST /pipeline/run-developer` runs a single LLM call (plan + patch together).
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
- persists `architect.planItems` in run state for developer steps (`developer-plan`, `developer-execute`, or `run-developer`)

### `POST /pipeline/developer-plan`

Developer **step 1**: plan + risks + test stubs only (one LLM call). Requires existing `architect.planItems` from `create-subtasks`. Persists `developerDraft` and posts a Jira comment with approval instructions.

Request body: same shape as `run-developer` (`issueKey`, optional `targetRepoPath`).

### `POST /pipeline/developer-execute`

Developer **step 2**: requires a saved `developerDraft` from `developer-plan`. One LLM call for `patchProposal` only. Merges into `developer` in run state, clears `developerDraft`, posts a Jira comment.

Request body: same as above.

### `POST /pipeline/run-developer`

Runs the developer in **one** LLM call (full JSON: plan + patch + notes). Same run-state and Jira behavior as before. Use when you do not need a human approval gate between plan and patch.

Request body:

```json
{
  "issueKey": "IOS-123",
  "targetRepoPath": "/absolute/path/to/target/repo"
}
```

Manual two-step example (same logic Jira Automation would call later):

```bash
curl -sS -X POST "http://localhost:3000/pipeline/developer-plan" \
  -H "Content-Type: application/json" \
  -d '{"issueKey":"IOS-123"}'

curl -sS -X POST "http://localhost:3000/pipeline/developer-execute" \
  -H "Content-Type: application/json" \
  -d '{"issueKey":"IOS-123"}'
```

### `POST /hooks/jira/comment`

Single entrypoint for **comment-shaped** triggers (returns `202` quickly, work runs async). Use the same JSON from `curl` while webhooks are absent.

Request body:

```json
{
  "issueKey": "IOS-123",
  "commentBody": "@developer plan story",
  "targetRepoPath": "/optional/absolute/repo"
}
```

Recognized `commentBody` / `comment` values (case-insensitive):

| Intent | Example phrase |
|--------|----------------|
| Architect refine | contains `@architect` and word `refine` |
| Developer plan | contains `@developer` and word `plan`, but **not** the execute phrase below |
| Developer execute | contains `@developer`, and `plan is approved` or `plan was approved`, and `start implementation` |

Execute is checked **before** plan so comments like “plan is approved … start implementation” do not match plan-only.

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

The suite includes tests for JSON repair, architect plan flow, Jira comment hook resolution (`jiraCommentHooks`), and developer agents.