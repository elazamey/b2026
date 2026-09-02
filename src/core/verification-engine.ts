import type { CheckResult, ScanContext, VerificationReport } from "../types.js";
import { SCANNERS } from "../scanners/index.js";
import { walkFiles } from "../util/files.js";
import { detectCommit, detectRepository } from "../util/git.js";
import { contractHash } from "./contract-engine.js";
import { decide } from "./decision-engine.js";

export function verify(ctx: Omit<ScanContext, "files">): VerificationReport {
  const files = walkFiles(ctx.root, ctx.contract.scan.ignore);
  const scanContext: ScanContext = { ...ctx, files };
  const checks: CheckResult[] = [];

  for (const [name, scanner] of Object.entries(SCANNERS)) {
    try {
      checks.push(scanner(scanContext));
    } catch (error) {
      checks.push({
        name: name as CheckResult["name"],
        status: "ERROR",
        findings: [
          {
            id: "ENG-001",
            rule: `engine.${name}`,
            severity: "error",
            message: `Scanner crashed: ${error instanceof Error ? error.message : String(error)}`,
            repair: "Fix the scanner error or exclude the offending path in scan.ignore.",
          },
        ],
        evidence: { error: true, violations: 1 },
        duration_ms: 0,
      });
    }
  }

  const repository = detectRepository(ctx.root);
  const commit = detectCommit(ctx.root);
  const hash = contractHash(ctx.contract);
  const decision = decide({
    checks,
    contract: ctx.contract,
    repository,
    commit,
    contractHash: hash,
    contractPath: "architecture.yaml",
  });

  return {
    repository,
    commit,
    contract_hash: hash,
    engine_version: decision.engine_version,
    checks,
    decision,
  };
}
