-- Turso state ledger. Not a source of truth.
-- Git remains the authority for architecture.yaml.
-- Guardian remains the authority for SAFE_TO_MERGE / REJECTED.

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contracts (
  hash TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  path TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  contract_hash TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  result TEXT NOT NULL,
  evidence_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS findings (
  scan_id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  rule TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  file TEXT,
  line INTEGER,
  repair TEXT
);

CREATE TABLE IF NOT EXISTS decisions (
  decision_id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  scan_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  contract_hash TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  result TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  record_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  evidence_hash TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scans_decision_id ON scans (decision_id);
CREATE INDEX IF NOT EXISTS idx_decisions_repo_time ON decisions (repository_id, timestamp);
