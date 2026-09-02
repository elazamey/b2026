# Control Plane (v0.6, read-only)

The Control Plane is a **viewer**. It is not Guardian, not GitHub, and not an agent.

```text
Dashboard → READ
Guardian  → DECIDE
GitHub    → ENFORCE
Turso     → STORE
Arena     → REPAIR
```

## What you can see

| Route | Content |
| --- | --- |
| `/` | Overview |
| `/repositories` | Repositories with a recorded history |
| `/repository/:id` | Decisions for one repository |
| `/decisions` | Sealed decision list |
| `/decision/:id` | `commit_sha`, `contract_hash`, `evidence_hash`, `result` |
| `/findings` | Violations attached to decisions |
| `/audit` | Lineage (`original_decision_id`, `repair_attempt_id`, commits) |

Add `?format=json` for machine-readable copies of the same data.

## What you cannot do

The HTTP surface is GET/HEAD only. POST, PUT, PATCH, and DELETE return **405**.

The dashboard cannot:

- declare `SAFE_TO_MERGE`
- convert `REJECTED` to `PASS`
- edit `architecture.yaml`
- rewrite a previous decision
- chat with an agent
- manage adapters

Turso queries from this layer are wrapped so that only `SELECT` runs.

## Run locally (free, no Vercel yet)

```bash
npx tsx src/cli.ts plane --host 0.0.0.0 --port 4173
```

If `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are set, the plane reads Turso. Otherwise it reads the local `.guardian/decisions` ledger so you can develop without a remote database.

v0.7 hosts this same plane on free Vercel. v0.6 does not deploy.

## Authority reminder

An unavailable Turso database does not change a Guardian decision. The Control Plane returning 503 also does not change a Guardian decision. GitHub `ai-guardian` remains the merge gate.
