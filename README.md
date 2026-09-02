# AI Architecture & Engineering Guardian

Deterministic verification for AI-generated changes.

The coding agent may propose and implement. It does not get to decide whether a change is safe to merge.

```text
Execution  ≠  Verification  ≠  Decision  ≠  Deployment  ≠  Data

Arena Agent     → executes
GitHub          → source of truth (code + architecture.yaml)
Guardian Core   → verifies (deterministic)
Decision Engine → SAFE TO MERGE / REJECTED
Vercel          → deploys only after merge
Turso           → records decisions (v0.3+)
Google APIs     → isolated external integrations
```

v0.2 closes the loop on GitHub:

- Sticky PR comment (markdown table of Evidence + Decision)
- Auditable Decision Ledger under `.guardian/decisions/`
- `GITHUB_TOKEN` only — no extra secrets, no OAuth app

The core remains deterministic. No LLM is required. AI review is optional and never the merge authority.

## Install

```bash
npm install
npm run build
```

```bash
npx tsx src/cli.ts check
# or after build:
node dist/cli.js check
```

## `ai-guardian check`

```text
AI Architecture & Engineering Guardian
────────────────────────────────────────

Repository: elazamey/b2026
Commit: 8a91f2d

Architecture        PASS
Dependencies        PASS
Security            PASS
Boundaries          PASS
Tests               PASS
Build               SKIP

────────────────────────────────────────
Decision: SAFE TO MERGE
Evidence: 6 checks
Violations: 0
Contract: sha256:...
```

On failure the CLI prints machine-usable findings, not a vibe:

```text
Decision: REJECTED

[BND-001]
Forbidden client import of "src/server"

File:
  src/components/User.ts:14

Expected:
  Client layer must not import src/server

Repair suggestion:
  Move data access behind an approved API/server boundary.
```

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | `SAFE_TO_MERGE` |
| 1 | `REJECTED` |
| 2 | Contract / usage error |

## Architecture contract

Git is the source of truth. The Guardian hashes `architecture.yaml` and stores that hash on every decision. That is how you later detect **contract drift**.

```yaml
version: "1"

project:
  type: "nextjs"

architecture:
  required_paths:
    - src/app
    - src/components
    - src/lib
    - src/server
  forbidden_paths:
    - src/legacy
    - tmp

dependencies:
  allowed:
    - next
    - react
    - zod
  forbidden:
    - vm2

security:
  secrets:
    forbid_in_source: true
  dangerous_patterns:
    - hardcoded_credentials
    - dynamic_code_execution
    - unsafe_child_process

boundaries:
  client:
    paths: [src/components, src/app]
    forbidden_imports: [src/server]
  server:
    paths: [src/server]
    forbidden_imports: [src/app/client-only]

quality:
  tests_required: true
  typecheck_required: true

merge:
  require:
    - architecture
    - dependencies
    - security
    - boundaries
    - tests
```

Create a starter contract with:

```bash
npx tsx src/cli.ts init
```

Schema: [`contracts/architecture.schema.yaml`](contracts/architecture.schema.yaml)

## Decision ledger

The Guardian does not record `PR #182 = PASS`. It records why.

```json
{
  "schema_version": "0.2",
  "decision_id": "dg_...",
  "repository": "owner/repo",
  "commit": "a81f3c2",
  "commit_sha": "a81f3c2...",
  "pull_request": {
    "number": 182,
    "url": "https://github.com/owner/repo/pull/182",
    "head_sha": "a81f3c2..."
  },
  "contract_hash": "sha256:...",
  "engine_version": "0.2.0",
  "timestamp": "2026-09-02T12:00:00.000Z",
  "result": "SAFE_TO_MERGE",
  "checks": {
    "architecture": "PASS",
    "dependencies": "PASS",
    "security": "PASS",
    "boundaries": "PASS",
    "tests": "PASS"
  },
  "violations": [],
  "evidence_hash": "sha256:..."
}
```

Written on every `ai-guardian check`:

```text
.guardian/decisions/
├── <decision_id>.json    # sealed record
├── latest.json           # most recent decision
└── index.json            # historical index (id, PR, hashes, result)
```

`--json` prints the ledger on stdout. `--out <file>` copies it elsewhere.

Schema: [`contracts/decision-ledger.schema.yaml`](contracts/decision-ledger.schema.yaml)

## PR comments

On `pull_request`, the Guardian upserts **one sticky comment** marked `<!-- ai-guardian-decision -->`.

It is updated in place as the agent repairs and pushes — closed-loop governance, not a flood of comments.

Authentication is `GITHUB_TOKEN` from GitHub Actions. No extra keys.

```bash
npx tsx src/cli.ts check --comment --pr 182
# requires GITHUB_TOKEN and GITHUB_REPOSITORY in the environment
```

## GitHub Action

```yaml
name: Guardian
on: [pull_request]
permissions:
  contents: read
  pull-requests: write
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: elazamey/b2026@main
```

The Action fails the check on `REJECTED`, writes GitHub annotations, posts/updates the PR comment, and exposes `decision`, `violations`, `decision_id`, `contract_hash`, `evidence_hash`, and `pull_request` as outputs.

Vercel, Turso, and Google APIs are not policy planes and are not wired yet.

## What v0.2 does not do

- No dashboard
- No LLM merge decision
- No Arena → Vercel production path
- No Turso as source of truth for the contract
- No Google credentials in Git, the contract, or prompts

Those come later, in this order:

| Version | Scope |
| --- | --- |
| **v0.1** | CLI + GitHub Action |
| **v0.2** | PR comments + Decision Ledger ← current |
| **v0.3** | Turso-backed control plane (recorded state only) |
| **v0.4** | Arena Agent feedback / repair loop |
| **v0.5** | Vercel deployment gate |
| **v1.0** | Hosted dashboard + SaaS |

## Layout

```text
src/
├── cli.ts
├── core/
│   ├── contract-engine.ts
│   ├── verification-engine.ts
│   ├── decision-engine.ts
│   └── evidence-engine.ts
├── scanners/
│   ├── architecture.ts
│   ├── dependencies.ts
│   ├── security.ts
│   ├── boundaries.ts
│   └── quality.ts
├── integrations/
│   └── github.ts
├── ledger/
│   └── decision-ledger.ts
└── report/
    └── reporter.ts
```

## Development

```bash
npm test
npm run typecheck
npx tsx src/cli.ts check
```

The Guardian verifies this repository against its own `architecture.yaml`.
