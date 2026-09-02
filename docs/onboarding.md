# Onboarding (free)

Three steps. No VPS, no paid API, no dashboard required.

## 1. Contract

In the repository you want guarded:

```bash
npx --yes github:elazamey/b2026 -- init
# or, from a clone of this project:
npx tsx src/cli.ts init
```

Edit `architecture.yaml`: required paths, forbidden dependencies, boundaries, merge checks.

Git is the source of truth for that file. Changing it is a deliberate human/contract change, not a repair.

## 2. Workflow

Copy [examples/github-workflow.yml](../examples/github-workflow.yml) to `.github/workflows/guardian.yml`.

The job **name** must stay `ai-guardian`. Rename it and the required check will not match.

```yaml
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

On a public repository, standard GitHub-hosted runners are free.

## 3. Owner lock (required)

Workflow alone does not block merge.

```text
GitHub → Settings → Rules → Rulesets → main
  Require a pull request before merging
  Require status checks to pass: ai-guardian
```

Until that ruleset exists, Guardian is a correct signal, not a merge barrier.

## What the developer sees

```text
SAFE TO MERGE
```

or

```text
REJECTED
  ARCH-003  SEC-002
  file:line
  expected
  forbidden / actual
  evidence hash
```

Repair: fix the findings, push a **new commit**. Guardian writes a new decision. Do not edit the contract to silence a rule. Do not declare merge.

Re-check the proof:

```bash
npx tsx src/cli.ts evidence
# VALID
```
