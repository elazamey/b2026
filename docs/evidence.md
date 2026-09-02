# Evidence hardening (v0.9.2)

A Guardian decision is not trusted because a file says `SAFE_TO_MERGE`. It is trusted because the scan evidence still hashes to the same proof.

```text
Code
  → Scan
  → Evidence
  → Hashes
  → Manifest
  → Decision
```

Not:

```text
Decision
  → "trust that the scan happened"
```

## Proof bundle

Every `ai-guardian check` writes:

```text
.guardian/evidence/evidence_manifest.json
.guardian/evidence/<decision_id>.json
```

Shape:

```json
{
  "schema": "guardian.evidence-manifest/v1",
  "decision_id": "...",
  "repository": "...",
  "commit_sha": "...",
  "contract_hash": "sha256:...",
  "engine_version": "0.9.2",
  "schema_version": "0.2",
  "timestamp": "...",
  "result": "REJECTED",
  "checks": [
    {
      "rule_id": "security",
      "status": "FAIL",
      "evidence": {},
      "evidence_hash": "sha256:..."
    }
  ],
  "repair_cycle": null,
  "evidence_hash": "sha256:...",
  "manifest_hash": "sha256:..."
}
```

`manifest_hash` covers every field except itself. Each check has its own `evidence_hash`. `evidence_hash` on the manifest is the sealed Decision hash.

## Re-verify

```bash
npx tsx src/cli.ts evidence
```

```text
VALID
```

If any check evidence, status, result, contract hash, repair cycle, or decision binding is changed:

```text
INVALID
Evidence hash mismatch
```

Tampering the manifest cannot convert `REJECTED` to `SAFE_TO_MERGE`. Guardian Core still decides. The bundle only proves what was scanned.
