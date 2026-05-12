# iOS Agent Pipeline

`ios-agent-pipeline` is a local orchestration server for Jira-driven iOS delivery: **architect** (story refine + description promotion), **developer**, **tester**, **reviewer**.

Server entrypoint: `src/server.js`

## What It Does

1. **Architect (refine)** — `POST /hooks/jira/comment` with `@architect refine` (or equivalent) reads `claude.md` from the path in the issue description (`Agent folder: …`) and posts a **refined story** as a Jira comment.
2. **Architect (approved)** — When the story is good, `@architect approved` (or `POST /pipeline/architect-approved`) copies the **latest** refined-story comment into the **issue description** (keeps an existing `Agent folder: …` line at the top when it is already in the description). Developer always reads **summary + description** (Agent folder line stripped for the LLM), not comments.
3. **Developer** — **Plan path:** `POST /pipeline/developer-plan` (or `@developer plan`) posts the plan, runs **architect review** of that plan, and on **approve** runs **implementation** automatically unless disabled in the request body. **One-shot:** `POST /pipeline/run-developer`. **Manual execute:** `POST /pipeline/developer-execute` if you skipped review or turned off auto-execute.
4. **Tester** / **Reviewer** — evaluate a supplied diff.

Run artifacts: **tester** / **reviewer** may still persist under `.data/pipeline-runs/<ISSUE_KEY>.json`. **Developer** plan/execute state lives only in **Jira comments** (see developer-plan comment body).

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

This app **does not** listen to Jira for new comments on its own. **Outgoing** comments are normal Jira activity and **do not** call your pipeline.

Pipeline steps run when **you** call the HTTP API (`curl` / Postman) or when **Jira Automation** sends HTTP (for example `POST /hooks/jira/comment`).

## API

All endpoints are JSON over HTTP.

### `GET /health`

Returns basic server status.

### `POST /pipeline/architect-approved`

Copies the **latest** Jira comment that starts with `Refined story (claude.md:` into the issue **description** (same behavior as the `@architect approved` comment hook). Preserves an existing `Agent folder: …` line at the top of the description when present.

Request body:

```json
{
  "issueKey": "IOS-123",
  "targetRepoPath": "/absolute/path/to/target/repo"
}
```

### `POST /pipeline/developer-plan`

Developer **step 1**: posts the plan Jira comment (human text + JSON trailer). Then an **architect LLM** reviews that plan against the story (`runArchitectReviewDeveloperPlan`). A second Jira comment records **APPROVE** or **REJECT** plus a short reason.

- If the architect **approves**, the server **automatically runs** the same work as `POST /pipeline/developer-execute` (patch + implementation comment), unless you opt out (see below).
- If the architect **rejects**, no implementation run; fix the story/plan and call developer-plan again.

Request body:

```json
{
  "issueKey": "IOS-123",
  "targetRepoPath": "/optional/repo",
  "skipArchitectReview": false,
  "autoExecuteOnArchitectApprove": true,
  "autoArchitectApprovedOnPlanReview": true
}
```

- **`skipArchitectReview`**: if `true`, only the developer plan comment is posted (legacy manual flow: you review in Jira yourself, then call `developer-execute` or the hook).
- **`autoExecuteOnArchitectApprove`**: if `false` and the architect still approves, you get the approve comment but **no** automatic patch; call `developer-execute` yourself. Defaults to **true** when omitted.
- **`autoArchitectApprovedOnPlanReview`**: if `true` (default), after an **approve** the server also runs the same logic as **`POST /pipeline/architect-approved`** (latest refine comment → issue description) before generating the patch; if that step fails (e.g. no refine comment yet), a short Jira note is posted and **implementation still runs**.

The same options are accepted on **`POST /hooks/jira/comment`** when the comment triggers developer plan (pass them in the JSON body next to `commentBody`).

### `POST /pipeline/developer-execute`

Developer **step 2**: reads the **latest** developer plan comment (same marker + JSON), runs patch LLM, posts the implementation comment. **No run-state draft file.**

Request body: `issueKey`, optional `targetRepoPath`.

### `POST /pipeline/run-developer`

One LLM call: full developer JSON (plan + patch + notes). Jira comment + HTTP response only; **no** developer entry in run-state JSON.

### `POST /hooks/jira/comment`

Comment-shaped triggers; returns **202** and runs work asynchronously.

```json
{
  "issueKey": "IOS-123",
  "commentBody": "@architect approved",
  "targetRepoPath": "/optional/absolute/repo"
}
```

| Intent | Rule (case-insensitive) |
|--------|-------------------------|
| Architect refine | `@architect` and word `refine` |
| Architect approved | `@architect` and word `approved`, and **not** word `refine` |
| Developer execute | `@developer`, `plan is approved` or `plan was approved`, and `start implementation` |
| Developer plan | `@developer` and `plan`, and not the execute rule above |

Refine is checked before approved. Comments that contain both `refine` and `approved` match **refine**.

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

```bash
npm test
```

The suite covers JSON repair, architect agent, refine routing, Jira comment hooks, developer planning input, and developer agents.
