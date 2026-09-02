# Gemini advisory reviewer (v0.8)

Gemini explains a **REJECTED** Guardian decision. It does not decide, merge, or rewrite history.

```text
Guardian Core
     │
deterministic scan
     │
PASS / REJECTED
     │
     └── REJECTED → Gemini (optional) → explanation + repair plan
                          │
                          ▼
                    Agent Adapter → new commit → Guardian again
```

## Authority

```text
decision.result     → Guardian only
ai_review           → advisory only
```

The two records never mix. Gemini cannot emit `SAFE_TO_MERGE` as a merge conclusion. If the model returns a `result` field, it is stripped.

## When it runs

`ai-guardian check` may request a review after a **REJECTED** decision if `GEMINI_API_KEY` is set. `--no-gemini` skips it. A missing key, HTTP failure, or Gemini off leaves the Guardian decision unchanged.

```text
Gemini OFF
Arena OFF
Turso OFF
      ↓
ai-guardian check
      ↓
SAFE_TO_MERGE / REJECTED
```

## Ledger

Reviews are stored beside decisions, not inside them:

```text
.guardian/reviews/<decision_id>.json
.guardian/reviews/latest.json
```

Shape:

```json
{
  "decision_id": "...",
  "authority": "advisory",
  "risk": "medium",
  "explanation": "...",
  "repair_plan": ["..."]
}
```

## HTTP

```text
POST /api/reviews/:decisionId
GET  /api/reviews/:decisionId
```

POST requires a signed-in member of the decision's project and a CSRF token. If Gemini is off the response is **503** and `result` is untouched. GET is read-only.

Vercel does not run Guardian. GitHub Actions remains the execution environment for `ai-guardian check`.
