# Required GitHub Gate (`ai-guardian`)

`SAFE_TO_MERGE` is not a comment. It is the conclusion of the required check named **`ai-guardian`**.

The coding agent cannot satisfy this check. Gemini cannot satisfy this check. Only the deterministic Guardian engine can.

## Free-first (public repository)

On a **public** repository, standard GitHub-hosted runners are free. Keep this repo public for the MVP.

## Enable the merge barrier

1. Settings → Branches → Add / Edit branch protection rule for `main`
2. Enable **Require status checks to pass before merging**
3. Search for and require:

```text
ai-guardian
```

Optionally also require `ci` (unit tests). The merge authority is still `ai-guardian`.

4. Enable **Require branches to be up to date before merging** if you want repairs re-checked against latest `main`.

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

- Not a Vercel deploy gate (v0.7)
- Not a dashboard (v0.6)
- Not an LLM vote
- Not an Arena-controlled check
