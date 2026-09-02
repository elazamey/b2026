# Required GitHub Gate (`ai-guardian`)

`SAFE_TO_MERGE` is not a comment. It is the conclusion of the required check named **`ai-guardian`**.

The coding agent cannot satisfy this check. Gemini cannot satisfy this check. Only the deterministic Guardian engine can.

## Free-first (public repository)

On a **public** repository, standard GitHub-hosted runners are free. Keep this repo public for the MVP.

## Enable the merge barrier (human admin)

The workflow job is not enough. `ai-guardian` must be a **required** status check on `main`.

This cannot be flipped by the coding agent. Creating a ruleset needs repository **admin**. The GitHub token in this environment returns HTTP 403 on `/rulesets` and branch protection.

A human admin:

1. Repository → **Settings** → **Rules** → **Rulesets** → New branch ruleset
2. Target: `main` (`refs/heads/main`)
3. Enable **Require a pull request before merging**
4. Enable **Require status checks to pass**
5. Search for and require:

```text
ai-guardian
```

Optionally also require `ci`. The architectural barrier is still `ai-guardian`.

6. Enable **Require branches to be up to date before merging** if repairs must re-check against latest `main`.

Until that ruleset exists, a user with bypass permission can still merge a red PR. After it exists, GitHub enforces Guardian.

Consumer onboarding (contract → workflow → this lock): [`onboarding.md`](onboarding.md). Production surface: [`production.md`](production.md).

## What the check reports

| Guardian decision | Check `ai-guardian` |
| --- | --- |
| `SAFE_TO_MERGE` | success |
| `REJECTED` | failure |
| Contract / CLI error | failure (job exit 2) |

The job name in [`.github/workflows/guardian.yml`](../.github/workflows/guardian.yml) is exactly `ai-guardian` so the required check name stays stable.

## Consumer workflow

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

The composite action fails the job on `REJECTED`. Add `--gate` / `GITHUB_TOKEN` if you also want an explicit Check Run.

## What this is not

- Not a Vercel deploy gate (Vercel only hosts the read-only Control Plane)
- Not a dashboard that can merge (v0.6 is read-only)
- Not an LLM vote
- Not an Arena-controlled check
