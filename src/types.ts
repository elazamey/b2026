export const ENGINE_VERSION = "0.1.0";

export type CheckName =
  | "architecture"
  | "dependencies"
  | "security"
  | "boundaries"
  | "tests"
  | "build";

export type CheckStatus = "PASS" | "FAIL" | "WARN" | "SKIP" | "ERROR";

export type DecisionResult = "SAFE_TO_MERGE" | "REJECTED";

export type ProjectType = "nextjs" | "node" | "generic";

export type Severity = "error" | "warning";

export interface Finding {
  id: string;
  rule: string;
  severity: Severity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  expected?: string;
  actual?: string;
  repair?: string;
}

export interface CheckEvidence {
  [key: string]: unknown;
}

export interface CheckResult {
  name: CheckName;
  status: CheckStatus;
  findings: Finding[];
  evidence: CheckEvidence;
  duration_ms: number;
}

export interface BoundaryLayer {
  paths: string[];
  forbidden_imports: string[];
}

export interface ArchitectureContract {
  version: string;
  project: {
    name?: string;
    type: ProjectType;
  };
  architecture: {
    required_paths: string[];
    forbidden_paths: string[];
  };
  dependencies: {
    allowed: string[] | null;
    forbidden: string[];
  };
  security: {
    secrets: {
      forbid_in_source: boolean;
    };
    dangerous_patterns: string[];
    ignore_paths: string[];
  };
  boundaries: Record<string, BoundaryLayer>;
  quality: {
    tests_required: boolean;
    typecheck_required: boolean;
    build_required: boolean;
    commands: {
      test?: string;
      typecheck?: string;
      build?: string;
    };
  };
  scan: {
    ignore: string[];
    include_globs: string[];
  };
  merge: {
    require: CheckName[];
  };
}

export interface ScanContext {
  root: string;
  contract: ArchitectureContract;
  files: string[];
}

export interface DecisionRecord {
  decision_id: string;
  repository: string;
  commit: string;
  contract_path: string;
  contract_hash: string;
  engine_version: string;
  timestamp: string;
  result: DecisionResult;
  checks: Record<string, CheckStatus>;
  violations: Finding[];
  evidence: Record<CheckName, CheckEvidence>;
  evidence_hash: string;
  summary: {
    checks_run: number;
    checks_passed: number;
    checks_failed: number;
    checks_skipped: number;
    violation_count: number;
  };
}

export interface VerificationReport {
  repository: string;
  commit: string;
  contract_hash: string;
  engine_version: string;
  checks: CheckResult[];
  decision: DecisionRecord;
}
