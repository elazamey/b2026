# Controlled Repair Orchestration (v0.9)

v0.9 is **not** multi-agent. It is a bounded repair loop around the existing Guardian.

```text
PR
 → Guardian (deterministic)
 → REJECTED
 → Gemini Advisory (optional explanation + repair plan)
 → Verifiable RepairTask
 → Agent Adapter (Arena first, then Manual)
 → new commit
 → Guardian re-check
 → PASS: stop
 → REJECTED: next attempt, or human after 3
```

The agent may repair violations more than once. It cannot grant itself passage.

## Hard barriers

```text
max_attempts: 3
may_modify_contract: false
may_declare_safe_to_merge: false
may_merge: false
merge_authority: guardian
```

Adapters refuse a task that raises the budget or claims merge authority.

## Verifiable task

The agent does not receive the full Guardian report as its work order. The task is:

```json
{
  "schema": "guardian.repair-task/v2",
  "task_id": "repair_<decision_id>",
  "decision_id": "...",
  "commit_sha": "...",
  "violations": [
    {
      "rule_id": "BND-001",
      "file": "src/components/User.ts",
      "line": 14,
      "expected": "Client layer must not import src/server",
      "forbidden": "src/server"
    }
  ],
  "constraints": {
    "may_declare_safe_to_merge": false,
    "may_modify_contract": false,
    "may_merge": false,
    "must_create_new_commit": true,
    "max_attempts": 3,
    "merge_authority": "guardian"
  }
}
```

GitHub remains the event bus. Guardian does not call Arena.

## Cycle ledger

Every repair attempt that produces a new commit also produces a **new** Decision. The original record is never rewritten.

Each cycle is stored independently under `.guardian/repairs/`:

```text
parent_decision_id
source_commit
findings
repair_provider
resulting_commit
resulting_decision_id
```

After three rejected attempts the loop stops. Human review. The agent still cannot merge.

## What this is not

- Not an independent agent system
- Not multi-agent
- Not a Core rewrite
- Not Gemini deciding `SAFE_TO_MERGE`

Next: v0.9.1 budget/timeout, v0.9.2 evidence, then v1.0 free MVP.
