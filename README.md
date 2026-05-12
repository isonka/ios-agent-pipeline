# iOS Agent Pipeline

`ios-agent-pipeline` is a local orchestration server for Jira-driven iOS delivery: **architect** (story refine + description promotion), **developer**, **tester**, **reviewer**.

Server entrypoint: `src/server.js`

## What It Does

1. **Architect (refine)** — `POST /hooks/jira/comment` with `@architect refine` (or equivalent) reads `claude.md` from the path in the issue description (`Agent folder: …`) and posts a **refined story** as a Jira comment.
2. **Architect (approved)** — When the story is good, `@architect approved` (or `POST /pipeline/architect-approved`) copies the **latest** refined-story comment into the **issue description** (keeps an existing `Agent folder: …` line at the top when it is already in the description). Developer always reads **summary + description** (Agent folder line stripped for the LLM), not comments.
3. **Developer** — **Two-step:** `POST /pipeline/developer-plan` then `POST /pipeline/developer-execute` (or the matching `@developer` hook phrases). **One-shot:** `POST /pipeline/run-developer`.
4. **Tester** / **Reviewer** — evaluate a supplied diff.

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

Developer **step 1**: plan + risks + test stubs (one LLM call). Uses **Jira summary + description** only (`Agent folder` stripped in the prompt). Requires non-empty summary/description after you have promoted the refined story with **architect-approved** (or manual edit).

Request body: `issueKey`, optional `targetRepoPath`.

### `POST /pipeline/developer-execute`

Developer **step 2**: requires `developerDraft` from `developer-plan`. One LLM call for `patchProposal`. Re-reads the issue description for context.

### `POST /pipeline/run-developer`

One LLM call: full developer JSON (plan + patch + notes).

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
