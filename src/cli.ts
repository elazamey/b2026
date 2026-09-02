#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { dirname, resolve } from "node:path";
import { ENGINE_VERSION, type DecisionRecord } from "./types.js";
import {
  ContractError,
  findContractPath,
  loadContract,
} from "./core/contract-engine.js";
import { verify } from "./core/verification-engine.js";
import { defaultLedgerDir, defaultLedgerPath } from "./ledger/decision-ledger.js";
import { renderReport } from "./report/reporter.js";
import { applyGithubProvenance, emitGithub } from "./integrations/github.js";
import { readGithubContext } from "./integrations/github-context.js";
import { defaultContractYaml } from "./core/init-template.js";
import { createDecisionStore } from "./store/create.js";
import { applyRepairLoop } from "./loop/apply.js";
import { buildFindingsPack, writeFindingsPack } from "./loop/findings-pack.js";
import {
  buildRepairCycle,
  readLastRepairProvider,
  writeRepairCycle,
} from "./loop/cycles.js";
import { MAX_REPAIR_ATTEMPTS } from "./loop/orchestrate.js";
import { dispatchRepairTask } from "./agents/dispatch.js";
import { detectParentCommitSha } from "./util/git.js";
import { createControlPlaneReader } from "./control-plane/reader.js";
import { createIdentityStore } from "./identity/store.js";
import { startSite } from "./web/server.js";
import { createGeminiReviewer, createReviewStore, isReviewSkip, reviewPath } from "./gemini/index.js";

function help(): string {
  return `
AI Architecture & Engineering Guardian

Usage:
  ai-guardian check [path]     Verify a repository against architecture.yaml
  ai-guardian findings [path]  Print the latest machine-readable findings pack
  ai-guardian plane [path]     Serve the product UI and admin Control Plane
  ai-guardian init [path]      Write a starter architecture.yaml contract
  ai-guardian version          Print engine version

Options:
  --contract <file>            Contract path (default: architecture.yaml)
  --json                       Machine-readable decision ledger on stdout
  --out <file>                 Write the decision ledger JSON to a file
  --comment                    Post or update the sticky PR comment
  --no-comment                 Do not post a PR comment
  --pr <number>                Pull request number (defaults to GitHub Actions event)
  --no-turso                   Do not persist to Turso even if credentials are set
  --no-gemini                  Do not request an advisory Gemini review
  --gate                       Publish the required GitHub check named ai-guardian
  --no-gate                    Do not publish a GitHub Check Run
  --host <addr>                Control plane bind address (default: 0.0.0.0)
  --port <number>              Control plane port (default: 4173)
  --no-color                   Disable ANSI colors
  --help                       Show this help
`.trim();
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      contract: { type: "string" },
      json: { type: "boolean", default: false },
      out: { type: "string" },
      help: { type: "boolean", default: false },
      "no-color": { type: "boolean", default: false },
      comment: { type: "boolean", default: false },
      "no-comment": { type: "boolean", default: false },
      pr: { type: "string" },
      "no-turso": { type: "boolean", default: false },
      "no-gemini": { type: "boolean", default: false },
      gate: { type: "boolean", default: false },
      "no-gate": { type: "boolean", default: false },
      host: { type: "string" },
      port: { type: "string" },
    },
  });

  if (values.help) {
    process.stdout.write(`${help()}\n`);
    return 0;
  }

  const command = positionals[0] ?? "check";
  const target = resolve(positionals[1] ?? ".");

  if (command === "version" || command === "--version") {
    process.stdout.write(`${ENGINE_VERSION}\n`);
    return 0;
  }

  if (command === "init") {
    return runInit(target, values.contract);
  }

  if (command === "findings") {
    return runFindings(target, Boolean(values.json));
  }

  if (command === "plane") {
    return runPlane(target, values.host, values.port);
  }

  if (command !== "check") {
    process.stderr.write(`Unknown command: ${command}\n\n${help()}\n`);
    return 2;
  }

  try {
    const contractPath = findContractPath(target, values.contract);
    const contract = loadContract(contractPath);
    const report = verify({ root: target, contract });
    report.decision.contract_path = contractPath;

    const prNumber = parsePr(values.pr);
    const context = readGithubContext(process.env, {
      pullRequest: prNumber,
    });
    applyGithubProvenance(report.decision, context);
    report.repository = report.decision.repository;
    report.commit = report.decision.commit;
    report.contract_hash = report.decision.contract_hash;

    const extraPath = values.out ? resolve(target, values.out) : undefined;
    const store = createDecisionStore({
      root: target,
      extraPath,
      env: process.env,
      disableTurso: Boolean(values["no-turso"]),
    });
    const previous = await store.getLatest(report.decision.repository);
    applyRepairLoop(report, {
      previous,
      parentCommitSha: detectParentCommitSha(target),
    });

    const color =
      !values["no-color"] && Boolean(process.stdout.isTTY) && !values.json;
    process.stdout.write(renderReport(report, { color, json: Boolean(values.json) }));

    const saved = await store.saveDecision(report.decision);
    report.decision = saved.record;
    const findingsPath = writeFindingsPack(target, buildFindingsPack(report.decision));
    const cyclePath = persistRepairCycle(target, previous, report.decision);
    const review = await maybeAdvisoryReview(target, report.decision, Boolean(values["no-gemini"]));
    const repairPlan = review && !isReviewSkip(review) ? review.repair_plan : [];
    const dispatched = await dispatchRepairTask({
      root: target,
      decision: report.decision,
      repairPlan,
    });

    if (!values.json) {
      const indexPath = resolve(defaultLedgerDir(target), "index.json");
      process.stdout.write(`Ledger: ${defaultLedgerPath(target, report.decision)}\n`);
      process.stdout.write(`Ledger index: ${indexPath}\n`);
      process.stdout.write(`Findings: ${findingsPath}\n`);
      if (cyclePath) {
        process.stdout.write(`Repair cycle: ${cyclePath}\n`);
      }
      if (dispatched.stopped === "exhausted") {
        process.stdout.write(
          `Repair budget exhausted (${MAX_REPAIR_ATTEMPTS}/${MAX_REPAIR_ATTEMPTS}). Human review. Agent cannot grant passage.\n`,
        );
      }
      if (dispatched.task) {
        const written = dispatched.results.find((item) => item.written)?.written;
        process.stdout.write(
          `Repair task: ${written ?? dispatched.task.decision_id} (${dispatched.results.map((item) => item.provider).join(", ")})\n`,
        );
      }
      if (saved.storage.turso === "persisted" || saved.storage.turso === "exists") {
        process.stdout.write(`Turso: ${saved.storage.turso} (${report.decision.decision_id})\n`);
      }
      if (review && !isReviewSkip(review)) {
        process.stdout.write(`Review: ${reviewPath(target, review.decision_id)} (advisory)\n`);
      }
      process.stdout.write("\n");
    }

    const shouldComment =
      !values["no-comment"] &&
      (values.comment || Boolean(context?.inActions && context.pullRequest));
    const shouldGate =
      !values["no-gate"] && (values.gate || Boolean(context?.inActions));

    await emitGithub(report, { comment: shouldComment, gate: shouldGate, context });

    if (report.decision.github?.comment_id || report.decision.github?.check_id) {
      await store.saveDecision(report.decision);
    }

    return report.decision.result === "SAFE_TO_MERGE" ? 0 : 1;
  } catch (error) {
    if (error instanceof ContractError) {
      process.stderr.write(`Contract error: ${error.message}\n`);
      for (const issue of error.issues) {
        process.stderr.write(`  - ${issue}\n`);
      }
      return 2;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

function persistRepairCycle(
  root: string,
  previous: DecisionRecord | null,
  current: DecisionRecord,
): string | undefined {
  if (!previous || !current.lineage) return undefined;
  const cycle = buildRepairCycle({
    previous,
    current,
    repairProvider: readLastRepairProvider(root, current.lineage.parent_decision_id),
  });
  if (!cycle) return undefined;
  return writeRepairCycle(root, cycle);
}

async function maybeAdvisoryReview(root: string, decision: DecisionRecord, disabled: boolean) {
  const result = await createGeminiReviewer({ env: process.env, disabled }).review(decision);
  if (isReviewSkip(result)) {
    if (result.reason === "unavailable") {
      process.stderr.write("Gemini unavailable. Guardian decisions are unchanged.\n");
    }
    return result;
  }
  await createReviewStore(root).save(result);
  return result;
}

function parsePr(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --pr value: ${value}`);
  }
  return parsed;
}

async function runPlane(target: string, hostFlag?: string, portFlag?: string): Promise<number> {
  const host = hostFlag?.trim() || "0.0.0.0";
  const port = Number.parseInt(portFlag ?? "4173", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    process.stderr.write(`Invalid --port value: ${portFlag}\n`);
    return 2;
  }
  const reader = createControlPlaneReader({ root: target, env: process.env });
  const identity = createIdentityStore({ root: target, env: process.env });
  startSite({
    host,
    port,
    reader,
    identity,
    reviews: createReviewStore(target),
    gemini: createGeminiReviewer({ env: process.env }),
  });
  process.stdout.write(
    `AI Guardian site http://${host}:${port}\nPublic /  App /app  Admin /admin\nSource: ${reader.kind}\nIdentity: server session (cookie is not a role)\nUI cannot decide or merge.\n`,
  );
  await new Promise(() => undefined);
  return 0;
}

function runInit(target: string, contractFlag?: string): number {
  const dest = resolve(target, contractFlag ?? "architecture.yaml");
  if (existsSync(dest)) {
    process.stderr.write(`Refusing to overwrite existing contract: ${dest}\n`);
    return 2;
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, defaultContractYaml(), "utf8");
  process.stdout.write(`Wrote contract ${dest}\n`);
  return 0;
}

function runFindings(target: string, json: boolean): number {
  const latest = resolve(target, ".guardian", "findings", "latest.json");
  if (!existsSync(latest)) {
    process.stderr.write("No findings pack found. Run `ai-guardian check` first.\n");
    return 2;
  }
  const raw = readFileSync(latest, "utf8");
  if (json) {
    process.stdout.write(raw.endsWith("\n") ? raw : `${raw}\n`);
    return 0;
  }
  process.stdout.write(raw.endsWith("\n") ? raw : `${raw}\n`);
  return 0;
}

const isDirect =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/cli.ts") ||
  process.argv[1]?.endsWith("/cli.js") ||
  process.argv[1]?.endsWith("ai-guardian");

if (isDirect) {
  const exitCode = await main(process.argv.slice(2));
  process.exit(exitCode);
}
