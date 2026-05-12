# iOS Agent Pipeline

`ios-agent-pipeline` is a local orchestration server for Jira-driven iOS delivery: **architect** (story refine + description promotion), **developer**, **tester**, **reviewer**.

Server entrypoint: `src/server.js`

## What It Does

1. **Architect (refine)** — `POST /hooks/jira/comment` with `@architect refine` (or equivalent) reads `claude.md` from the path in the issue description (`Agent folder: …`) and posts a **refined story** as a Jira comment.
2. **Architect (approved)** — `@architect approved` (or `POST /pipeline/architect-approved`) copies the **latest** refined-story comment into the **issue description** (keeps an existing `Agent folder: …` line when present). Developer reads **summary + description** for coding context (not other comments for scope).
3. **Developer (plan)** — `POST /pipeline/developer-plan` or `@developer plan` posts **one** Jira comment: human plan + hidden JSON draft marker. **Stops there** (next turn is architect).
4. **Architect (check plan)** — `@architect check plan` or `POST /pipeline/architect-check-plan`: reads the latest developer plan from Jira comments, runs architect LLM review, posts **APPROVE** or **REJECT** + reason only (no implementation, no description sync).
5. **Developer (execute)** — After you accept the plan in process, `POST /pipeline/developer-execute` or `@developer` + plan approved + `start implementation` generates the patch from the latest plan comment.
6. **One-shot** — `POST /pipeline/run-developer` (single LLM, plan + patch).
7. **Tester** / **Reviewer** — evaluate a supplied diff.

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

### `POST /pipeline/architect-check-plan`

**Architect turn:** reads the latest **developer plan** Jira comment (JSON marker), runs the architect review LLM, posts **APPROVE** or **REJECT** + short guidance. Does **not** run `developer-execute` or `architect-approved`.

Same as a comment containing **`@architect check plan`** (no `refine` in that comment).

Request body: `issueKey`, optional `targetRepoPath`.

### `POST /pipeline/developer-plan`

Developer **plan** turn: one LLM call, then **one** Jira comment (human plan + hidden JSON trailer). **No** architect review and **no** implementation in this step.

Request body: `issueKey`, optional `targetRepoPath`.

### `POST /pipeline/developer-execute`

Reads the latest developer plan from Jira comments, runs the patch LLM, then **`git apply`** in the **target repo**. On success it creates a **local** branch and **one commit** (same skip flags as below). Jira comment includes apply status, branch name, short commit hash, and the diff (truncated). Requires `git` on the server `PATH`, and the target repo should have `user.name` / `user.email` configured for commits.

Branch name convention: **`feat/{userSlug}/{ISSUEKEY}-{summary-slug}`** (example: `feat/okarsli/MP-17833-add-login-flow`). **`userSlug`** comes from, in order: env **`DEVELOPER_BRANCH_USER_SLUG`**, else Jira assignee **email local-part**, else slugified **displayName**, else `developer`.

- **`DEVELOPER_SKIP_GIT_APPLY=true`** — skip `git apply` (diff-only / dry behavior).
- **`DEVELOPER_SKIP_GIT_COMMIT=true`** — apply patch but do **not** create branch or commit (useful for local inspection before committing).

Request body: `issueKey`, optional `targetRepoPath`.

Response may include **`developerBranch`** and **`developerCommitSha`** when commit succeeds.

### `POST /pipeline/run-developer`

One LLM call (plan + patch). Applies the patch with **`git apply`** when `patchProposal` is non-empty, then creates the **`feat/...`** branch and commit (same env vars as developer-execute).

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
| Architect check plan | `@architect` and phrase `check plan`, and **not** word `refine` |
| Architect approved | `@architect` and word `approved`, and **not** word `refine` |
| Developer execute | `@developer`, `plan is approved` or `plan was approved`, and `start implementation` |
| Developer plan | `@developer` and `plan`, and not the execute rule above |

Refine is checked first, then **check plan**, then approved, then developer rules.

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
