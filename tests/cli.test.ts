import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const cli = resolve(repo, "src/cli.ts");

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  const tsx = resolve(repo, "node_modules/.bin/tsx");
  const result = spawnSync(tsx, [cli, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("ai-guardian CLI", () => {
  it("prints the engine version", () => {
    const result = run(["version"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /0\.1\.0/);
  });

  it("emits a decision ledger JSON for the passing fixture", () => {
    const target = resolve(repo, "tests/fixtures/pass-project");
    const result = run(["check", target, "--json", "--no-color"]);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as { result: string };
    assert.equal(parsed.result, "SAFE_TO_MERGE");
  });

  it("exits 1 and prints REJECTED for the failing fixture", () => {
    const target = resolve(repo, "tests/fixtures/fail-project");
    const result = run(["check", target, "--no-color"]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /REJECTED/);
    assert.match(result.stdout, /\[BND-001\]/);
    assert.match(result.stdout, /Repair suggestion/);
  });
});
