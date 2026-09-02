#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { dirname, resolve } from "node:path";
import { ENGINE_VERSION } from "./types.js";
import {
  ContractError,
  findContractPath,
  loadContract,
} from "./core/contract-engine.js";
import { verify } from "./core/verification-engine.js";
import { writeLedger, defaultLedgerPath } from "./ledger/decision-ledger.js";
import { renderReport } from "./report/reporter.js";
import { emitGithub } from "./integrations/github.js";
import { defaultContractYaml } from "./core/init-template.js";

function help(): string {
  return `
AI Architecture & Engineering Guardian

Usage:
  ai-guardian check [path]     Verify a repository against architecture.yaml
  ai-guardian init [path]      Write a starter architecture.yaml contract
  ai-guardian version          Print engine version

Options:
  --contract <file>            Contract path (default: architecture.yaml)
  --json                       Machine-readable decision ledger on stdout
  --out <file>                 Write the decision ledger JSON to a file
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

  if (command !== "check") {
    process.stderr.write(`Unknown command: ${command}\n\n${help()}\n`);
    return 2;
  }

  try {
    const contractPath = findContractPath(target, values.contract);
    const contract = loadContract(contractPath);
    const report = verify({ root: target, contract });
    report.decision.contract_path = contractPath;

    const color =
      !values["no-color"] && Boolean(process.stdout.isTTY) && !values.json;
    process.stdout.write(renderReport(report, { color, json: Boolean(values.json) }));

    const outPath = values.out
      ? resolve(target, values.out)
      : defaultLedgerPath(target, report.decision);
    writeLedger(outPath, report.decision);

    if (!values.json) {
      process.stdout.write(`Ledger: ${outPath}\n\n`);
    }

    emitGithub(report);
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

const isDirect =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/cli.ts") ||
  process.argv[1]?.endsWith("/cli.js") ||
  process.argv[1]?.endsWith("ai-guardian");

if (isDirect) {
  const exitCode = await main(process.argv.slice(2));
  process.exit(exitCode);
}
