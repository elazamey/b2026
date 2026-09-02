# Production contract (Free MVP)

This is the supported surface a real developer can rely on. It is not a promise that generated code is safe.

```text
Guardian = Authority
GitHub    = Enforcement
Proof     = Verifiable Evidence
AI        = Non-authoritative Actor
Core      = Provider-independent
UI        = Control Plane
```

Engine version at freeze: **0.9.2**. Semver **1.0.0** is not claimed until `ai-guardian` is a required status check on `main`.

## Supported

| Surface | Contract |
| --- | --- |
| Repository | Git repository with `architecture.yaml` at the root (or `--contract`) |
| Runtime | Node.js ≥ 20, production dependency `yaml` only |
| CLI | `check`, `init`, `evidence`, `findings`, `plane`, `version` |
| Checks | `architecture`, `dependencies`, `security`, `boundaries`, `tests`; `build` optional |
| GitHub workflow | Job **name** must be `ai-guardian` |
| Action | `elazamey/b2026@<ref>` composite action |
| Evidence | `guardian.evidence-manifest/v1` |
| Ledger schema | `0.2` |
| Exit codes | `0` `SAFE_TO_MERGE` · `1` `REJECTED` · `2` contract/usage error |

## Failure semantics

| Guardian `result` | Process | GitHub check `ai-guardian` |
| --- | --- | --- |
| `SAFE_TO_MERGE` | exit 0 | success |
| `REJECTED` | exit 1 | failure |
| Contract / CLI error | exit 2 | failure |

Comment ≠ gate. Gemini ≠ gate. Arena ≠ gate. Human UI ≠ gate.

Invalid proof cannot change the decision. A tampered manifest cannot convert `REJECTED` into `SAFE_TO_MERGE`.

## What Guardian proves

Given this commit, this contract hash, and this engine version, the listed checks produced these findings, and the hashes still match.

```bash
ai-guardian check
ai-guardian evidence
# VALID
```

## What Guardian does not prove

- That the program is free of vulnerabilities beyond the configured scanners
- That business logic is correct
- That tests are meaningful, only that they exist when required
- That a human reviewed the change
- That GitHub will block merge — that requires an Owner ruleset

Do not market: “Guardian guarantees the code is safe.”

Market: “Guardian enforces a verifiable engineering contract and deterministic quality/security gates.”

## Repair

```text
Agent repair → new commit → Guardian → new decision
```

The agent cannot declare `SAFE_TO_MERGE`, cannot merge, and cannot edit `architecture.yaml` to bypass a finding (`CTR-001`). Budget: 3 attempts, 900s, 500 diff lines, 50 files, 32k tokens.

## Free stack

Required for Core: Git + GitHub Actions on a **public** repository.

Optional adapters (Core still decides if they are off):

```text
Turso   = state
Vercel  = presentation
Gemini  = advisory
Arena   = repair execution
```

## Open Core

The merge barrier is not a paid feature.

```text
OPEN CORE     Guardian engine, GitHub gate, contract, evidence, CLI
LATER / PAID  hosted Control Plane, org policies, analytics, connectors
```

## External enforcement (Owner)

The workflow job is not the lock. A human admin must require the status check named `ai-guardian` on `main`. See [github-gate.md](github-gate.md) and [onboarding.md](onboarding.md).
