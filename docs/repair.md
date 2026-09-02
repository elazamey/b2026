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
max_runtime_seconds: 900
max_diff_lines: 500
max_files_changed: 50
max_tokens_per_cycle: 32000
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
    "max_runtime_seconds": 900,
    "max_diff_lines": 500,
    "max_files_changed": 50,
    "max_tokens_per_cycle": 32000,
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

## Budget, timeout, abuse controls (v0.9.1)

The loop records **why a cycle ended**. That status is not the Guardian decision.

```text
RUNNING
TIMEOUT
BUDGET_EXCEEDED
PROVIDER_ERROR
PATCH_REJECTED
RECHECK_FAILED
COMPLETED
```

```text
Agent failure ≠ Guardian rejection
Guardian rejection ≠ infrastructure failure
```

| Cycle status | Class | Guardian `result` |
| --- | --- | --- |
| `TIMEOUT` / `BUDGET_EXCEEDED` / `PATCH_REJECTED` | agent | unchanged |
| `PROVIDER_ERROR` | infrastructure | unchanged |
| `RECHECK_FAILED` | guardian | `REJECTED` |
| `COMPLETED` | guardian | `SAFE_TO_MERGE` |

Timeout, oversized diffs, and provider errors stop further dispatch. They do not convert a decision to `REJECTED` or `SAFE_TO_MERGE`.

## What this is not

- Not an independent agent system
- Not multi-agent
- Not a Core rewrite
- Not Gemini deciding `SAFE_TO_MERGE`

Next: v0.9.2 evidence, then v1.0 free MVP.
