# AI Architecture & Engineering Guardian

Deterministic verification for AI-generated changes.

The coding agent may propose and implement. It does not get to decide whether a change is safe to merge.

```text
Execution  ≠  Verification  ≠  Decision  ≠  Deployment  ≠  Data

Arena Agent     → executes
GitHub          → source of truth (code + architecture.yaml)
Guardian Core   → verifies (deterministic)
Decision Engine → SAFE TO MERGE / REJECTED
Vercel          → hosts Control Plane (read-only, never decides)
Turso           → records decisions (v0.3+)
Google APIs     → isolated external integrations
```

Free-first 2026: no VPS, no paid worker, no LLM in the core.

```text
Git            = source of truth (architecture.yaml)
Guardian       = decision authority (SAFE TO MERGE / REJECTED)
GitHub         = event bus + required merge gate (`ai-guardian`)
Agent adapter  = Arena / manual / future — never merge authority
Turso          = optional remote state/evidence store
```

The agent may repair and push a **new commit**. It cannot edit `architecture.yaml` to bypass a finding, cannot declare `SAFE TO MERGE`, and cannot rewrite a previous decision. Each re-check writes a **new** ledger record with lineage:

```text
original_decision_id → repair_attempt_id → parent_commit_sha → new_commit_sha
```

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
  "engine_version": "0.9.0",
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
  checks: write
jobs:
  ai-guardian:
    name: ai-guardian
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - uses: elazamey/b2026@main
```

The Action fails the job on `REJECTED`, writes GitHub annotations, posts/updates the PR comment, publishes the required check **`ai-guardian`**, and exposes `decision`, `violations`, `decision_id`, `contract_hash`, `evidence_hash`, and `pull_request` as outputs.

Require that check on `main`: see [`docs/github-gate.md`](docs/github-gate.md). On a **public** repository, standard GitHub-hosted runners are free.

Optional Turso persistence uses `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. They are never required. An unavailable database does not flip `SAFE_TO_MERGE` into `REJECTED`.

## Turso (optional state ledger)

Turso stores scans, decisions, and evidence. It does **not** store the living contract.

```text
Git
 └── architecture.yaml
        ↓
   contract_hash
        ↓
 Guardian Engine
        ↓
 Decision
        ↓
 Local ledger ──optional──▶ Turso
```

Each persisted scan keeps:

```text
repository, commit_sha, contract_hash, engine_version,
schema_version, timestamp, result, evidence_hash, decision_id
```

Writes are idempotent on `decision_id`. Sealed fields (`result`, hashes, commit) cannot be overwritten later.

```bash
# local only — always the default
npx tsx src/cli.ts check

# optional remote persistence
export TURSO_DATABASE_URL=libsql://...
export TURSO_AUTH_TOKEN=...
npx tsx src/cli.ts check
```

Schema: [`contracts/turso.schema.sql`](contracts/turso.schema.sql)

## Repair loop (v0.4) and Controlled Repair Orchestration (v0.9)

Guardian does **not** call Arena. Arena is an optional **Agent Provider**. GitHub carries the event:

```text
PR → Guardian → REJECTED → Gemini advisory (optional)
  → verifiable RepairTask (not the full report)
  → Adapter (Arena | Manual | Future)
  → new commit → push → Guardian again
  → PASS: stop  |  REJECTED: next attempt, or human after 3
```

Hard barriers: `max_attempts: 3`, `may_modify_contract: false`, `may_declare_safe_to_merge: false`, `may_merge: false`.

```bash
npx tsx src/cli.ts check
npx tsx src/cli.ts findings --json
```

A repair that changes `architecture.yaml` is rejected with `CTR-001` even if every other check would pass. Each attempt writes a new Decision and an independent cycle under `.guardian/repairs/`. Details: [`docs/repair.md`](docs/repair.md).

## Required GitHub gate (v0.5)

`SAFE_TO_MERGE` is the conclusion of the required check named `ai-guardian`.

| Decision | Check `ai-guardian` |
| --- | --- |
| `SAFE_TO_MERGE` | success |
| `REJECTED` | failure |

Gemini, Arena, and a human reviewer cannot flip that conclusion. Setup: [`docs/github-gate.md`](docs/github-gate.md).

## Control Plane (v0.6, read-only)

```bash
npx tsx src/cli.ts plane --host 0.0.0.0 --port 4173
```

```text
Dashboard → READ
Guardian  → DECIDE
GitHub    → ENFORCE
Turso     → STORE
Arena     → REPAIR
```

Routes: `/repositories`, `/repository/:id`, `/decisions`, `/decision/:id`, `/findings`, `/audit`.

Admin Control Plane lives at `/admin` (`platform_admin` session only). The public product is `/` and `/app`. Setup: [`docs/control-plane.md`](docs/control-plane.md), [`docs/public-ui.md`](docs/public-ui.md), [`docs/identity.md`](docs/identity.md). Enable the merge lock: [`docs/github-gate.md`](docs/github-gate.md).

## Vercel hosting (v0.7)

Vercel publishes the Control Plane. It does **not** run Guardian.

```text
Browser → Vercel → Control Plane → Turso
GitHub Actions → Guardian → required check ai-guardian
```

```bash
npm run build
node dist/cli.js check          # works with Vercel/Turso/Arena/Gemini off
node dist/cli.js plane --host 0.0.0.0 --port 4173
```

Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in the Vercel dashboard only. Never in Git. Deploy notes: [`docs/vercel.md`](docs/vercel.md).

## What this release does not do

- No Gemini merge decision (v0.8, optional explanation only)
- No Turso as source of truth for the contract
- No always-on VPS
- No chat / agent console in the dashboard
- Vercel is not required for `ai-guardian check`

Those come later, in this order:

| Version | Scope |
| --- | --- |
| **v0.1** | CLI + GitHub Action |
| **v0.2** | PR comments + Decision Ledger |
| **v0.3** | Turso state ledger (optional, recorded state only) |
| **v0.4** | Agent Adapter + repair loop + audit trail |
| **v0.5** | Required GitHub gate (`ai-guardian`) |
| **v0.6** | Web Control Plane (reads Turso, does not decide) |
| **v0.7** | Free Vercel hosting for the Control Plane |
| **v0.7.1** | Public user frontend (`/`, `/app`) + admin `/admin` |
| **v0.7.2** | Identity & authorization (server session, Role ≠ Ownership) |
| **v0.7.3** | Session/CSRF/resource authz/bootstrap-once/login rate limit |
| **v0.8.0** | Gemini optional reviewer (advisory only, never the gate) |
| **v0.9.0** | Controlled Repair Orchestration (max 3, verifiable task) ← current |
| **v0.9.1** | Repair budget / timeout |
| **v0.9.2** | Repair evidence |
| **v1.0** | Open Core + free hosted MVP |

## Layout

```text
src/           core, scanners, gate, agents, control-plane, identity, gemini, web
api/plane.ts   Vercel adapter (read-only, not Guardian)
vercel.json    Hobby hosting for the Control Plane
```

## Development

```bash
npm test
npm run typecheck
npx tsx src/cli.ts check
npx tsx src/cli.ts plane --host 0.0.0.0 --port 4173
```

The Guardian verifies this repository against its own `architecture.yaml`.
