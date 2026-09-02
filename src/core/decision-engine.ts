import type {
  ArchitectureContract,
  CheckName,
  CheckResult,
  CheckStatus,
  DecisionRecord,
  Finding,
  GithubProvenance,
  PullRequestRef,
} from "../types.js";
import { ENGINE_VERSION, LEDGER_SCHEMA_VERSION } from "../types.js";
import { decisionId } from "../util/id.js";
import { evidenceHash } from "./evidence-engine.js";

export function decide(input: {
  checks: CheckResult[];
  contract: ArchitectureContract;
  repository: string;
  commit: string;
  contractHash: string;
  contractPath: string;
  commitSha?: string;
  branch?: string;
  pullRequest?: PullRequestRef | null;
  github?: GithubProvenance | null;
}): DecisionRecord {
  const required = new Set<CheckName>(input.contract.merge.require);
  const checks: Record<string, CheckStatus> = {};
  const blocking: Finding[] = [];

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const check of input.checks) {
    checks[check.name] = check.status;
    if (check.status === "PASS") passed += 1;
    if (check.status === "FAIL" || check.status === "ERROR") failed += 1;
    if (check.status === "SKIP") skipped += 1;

    const isRequired = required.has(check.name);
    if (!isRequired) continue;
    if (check.status === "FAIL" || check.status === "ERROR") {
      blocking.push(...check.findings);
    }
  }

  const result =
    blocking.length > 0 || requiredFailWithoutFinding(input.checks, required)
      ? "REJECTED"
      : "SAFE_TO_MERGE";

  const evidence: DecisionRecord["evidence"] = {
    architecture: {},
    dependencies: {},
    security: {},
    boundaries: {},
    tests: {},
    build: {},
  };
  for (const check of input.checks) {
    evidence[check.name] = check.evidence;
  }

  const record: DecisionRecord = {
    schema_version: LEDGER_SCHEMA_VERSION,
    decision_id: decisionId(),
    repository: input.repository,
    commit: input.commit,
    commit_sha: input.commitSha,
    branch: input.branch,
    pull_request: input.pullRequest ?? null,
    github: input.github ?? null,
    contract_path: input.contractPath,
    contract_hash: input.contractHash,
    engine_version: ENGINE_VERSION,
    timestamp: new Date().toISOString(),
    result,
    checks,
    violations: result === "REJECTED" ? blocking : [],
    evidence,
    evidence_hash: "",
    summary: {
      checks_run: input.checks.length,
      checks_passed: passed,
      checks_failed: failed,
      checks_skipped: skipped,
      violation_count: result === "REJECTED" ? blocking.length : 0,
    },
  };
  record.evidence_hash = evidenceHash(record);
  return record;
}

function requiredFailWithoutFinding(
  checks: CheckResult[],
  required: Set<CheckName>,
): boolean {
  return checks.some(
    (check) =>
      required.has(check.name) &&
      (check.status === "FAIL" || check.status === "ERROR") &&
      check.findings.length === 0,
  );
}
