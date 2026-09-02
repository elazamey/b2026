import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ContractError,
  contractHash,
  loadContract,
  validateContract,
} from "../src/core/contract-engine.ts";

const root = resolve(import.meta.dirname, "..");

describe("contract-engine", () => {
  it("loads and hashes the repository contract", () => {
    const contract = loadContract(resolve(root, "architecture.yaml"));
    assert.equal(contract.version, "1");
    assert.equal(contract.project.type, "node");
    const hash = contractHash(contract);
    assert.match(hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(contractHash(contract), hash);
  });

  it("rejects an invalid version", () => {
    assert.throws(
      () => validateContract({ version: "9", project: { type: "node" } }),
      (error: unknown) => error instanceof ContractError && error.issues.length > 0,
    );
  });

  it("parses the published schema file as YAML object", () => {
    const raw = readFileSync(resolve(root, "contracts/architecture.schema.yaml"), "utf8");
    assert.match(raw, /title: AI Guardian Architecture Contract/);
  });
});
