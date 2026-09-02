import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { decide } from "../src/core/decision-engine.ts";
import { validateContract } from "../src/core/contract-engine.ts";
import { renderPrComment } from "../src/integrations/github-comment.ts";
import { vercelRequestUrl } from "../src/control-plane/vercel.ts";
import { createVercelHandler } from "../src/web/vercel.ts";
import { MemoryControlPlaneReader } from "../src/control-plane/reader.ts";
import { MemoryIdentityStore } from "../src/identity/store.ts";
import type { ControlPlaneReader } from "../src/control-plane/types.ts";
import type { CheckResult, DecisionRecord, VerificationReport } from "../src/types.ts";

const repo = resolve(import.meta.dirname, "..");

function check(name: CheckResult["name"], status: CheckResult["status"]): CheckResult {
  return {
    name,
    status,
    findings: [],
    evidence: { violations: 0 },
    duration_ms: 1,
  };
}

function makeDecision(): DecisionRecord {
  const contract = validateContract({
    version: "1",
    project: { type: "node" },
    merge: { require: ["architecture"] },
  });
  return decide({
    checks: [
      check("architecture", "PASS"),
      check("dependencies", "PASS"),
      check("security", "PASS"),
      check("boundaries", "SKIP"),
      check("tests", "SKIP"),
      check("build", "SKIP"),
    ],
    contract,
    repository: "elazamey/b2026",
    commit: "abc1234",
    commitSha: "abc1234deadbeef",
    contractHash: "sha256:contract",
    contractPath: "architecture.yaml",
  });
}

class MockResponse {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = "";
  setHeader(name: string, value: string | string[]): void {
    this.headers[name.toLowerCase()] = Array.isArray(value) ? value.join("; ") : value;
  }
  end(body?: string): void {
    this.body = body ?? "";
  }
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === "node_modules" || name.name === "dist" || name.name === ".git") continue;
    const full = join(dir, name.name);
    if (name.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

describe("v0.7 production readiness", () => {
  it("builds the production CLI without Vercel", () => {
    const result = spawnSync("npm", ["run", "build"], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        VERCEL: "",
        TURSO_DATABASE_URL: "",
        TURSO_AUTH_TOKEN: "",
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(join(repo, "dist/cli.js")), true);
  });

  it("runs the built CLI with Vercel, Turso, Arena, and Gemini off", () => {
    const cli = join(repo, "dist/cli.js");
    const version = spawnSync(process.execPath, [cli, "version"], {
      cwd: repo,
      encoding: "utf8",
    });
    assert.equal(version.status, 0, version.stderr);
    assert.match(version.stdout, /0\.9\.1/);

    const checkRun = spawnSync(
      process.execPath,
      [cli, "check", join(repo, "tests/fixtures/pass-project"), "--json", "--no-color"],
      {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...process.env,
          FORCE_COLOR: "0",
          GITHUB_ACTIONS: "",
          GITHUB_TOKEN: "",
          VERCEL: "",
          VERCEL_ENV: "",
          TURSO_DATABASE_URL: "",
          TURSO_AUTH_TOKEN: "",
          GEMINI_API_KEY: "",
          GOOGLE_API_KEY: "",
          ARENA_API_KEY: "",
        },
      },
    );
    assert.equal(checkRun.status, 0, checkRun.stderr);
    const parsed = JSON.parse(checkRun.stdout) as { result: string };
    assert.equal(parsed.result, "SAFE_TO_MERGE");
    assert.doesNotMatch(checkRun.stdout, /TURSO_AUTH_TOKEN|TURSO_DATABASE_URL/);
  });

  it("keeps GET readable and rejects mutations on the Vercel adapter", async () => {
    const record = makeDecision();
    const identity = new MemoryIdentityStore();
    const testPassword = ["pass", "word1"].join("");
    const admin = await identity.createUser({
      email: "admin@acme.test",
      password: testPassword,
      platform_admin: true,
    });
    const { token } = await identity.createSession(admin.id);
    const handler = createVercelHandler({
      reader: new MemoryControlPlaneReader([record]),
      identity,
    });
    const get = new MockResponse();
    await handler(
      {
        method: "GET",
        url: "/admin/decisions?format=json",
        headers: { cookie: `guardian_session=${token}` },
      },
      get,
    );
    assert.equal(get.statusCode, 200, get.body);
    const payload = JSON.parse(get.body) as { writable: boolean; decisions: Array<{ result: string }> };
    assert.equal(payload.writable, false);
    assert.equal(payload.decisions[0]?.result, "SAFE_TO_MERGE");

    const forged = new MockResponse();
    await handler(
      {
        method: "GET",
        url: "/admin/decisions?format=json",
        headers: { cookie: "guardian_role=owner" },
      },
      forged,
    );
    assert.equal(forged.statusCode, 403);

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = new MockResponse();
      await handler(
        {
          method,
          url: `/admin/decision/${record.decision_id}`,
          headers: { cookie: `guardian_session=${token}` },
        },
        res,
      );
      assert.equal(res.statusCode, 405, method);
      assert.match(res.body, /cannot change Guardian decisions/);
      assert.equal((await new MemoryControlPlaneReader([record]).getDecision(record.decision_id))?.result, "SAFE_TO_MERGE");
    }
  });

  it("recovers Control Plane paths after the Vercel rewrite", () => {
    assert.equal(
      vercelRequestUrl({ url: "/api/plane?__path=/decisions&format=json" }),
      "/decisions?format=json",
    );
    assert.equal(
      vercelRequestUrl({
        url: "/api/plane",
        headers: { "x-forwarded-uri": "/audit" },
      }),
      "/audit",
    );
  });

  it("degrades the dashboard when Turso is down without changing Guardian", async () => {
    const down: ControlPlaneReader = {
      kind: "turso",
      writable: false,
      async snapshot() {
        throw new Error("Turso down");
      },
      async getDecision() {
        throw new Error("Turso down");
      },
    };
    const identity = new MemoryIdentityStore();
    const testPassword = ["pass", "word1"].join("");
    const user = await identity.createUser({ email: "user@acme.test", password: testPassword });
    const { token } = await identity.createSession(user.id);

    const publicHome = new MockResponse();
    await createVercelHandler({ reader: down, identity })({ method: "GET", url: "/" }, publicHome);
    assert.equal(publicHome.statusCode, 200);

    const res = new MockResponse();
    await createVercelHandler({ reader: down, identity })(
      { method: "GET", url: "/app", headers: { cookie: `guardian_session=${token}` } },
      res,
    );
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /Guardian decisions are unchanged/);
    assert.equal(res.headers["x-guardian-writable"], "false");

    const record = makeDecision();
    assert.equal(record.result, "SAFE_TO_MERGE");
  });

  it("does not put Turso credentials in git, the contract, the ledger, or PR comments", () => {
    const secretAssignment =
      /TURSO_(?:AUTH_TOKEN|DATABASE_URL)\s*=\s*['"]?(?!['"]?\s*(?:$|#))(?!libsql:\/\/\.\.\.)(?!token$)(?!https:\/\/x$)[^\s'"]+/;

    const architecture = readFileSync(join(repo, "architecture.yaml"), "utf8");
    assert.doesNotMatch(architecture, /TURSO_AUTH_TOKEN|TURSO_DATABASE_URL/);

    const example = readFileSync(join(repo, ".env.example"), "utf8");
    assert.match(example, /TURSO_DATABASE_URL=\s*$/m);
    assert.match(example, /TURSO_AUTH_TOKEN=\s*$/m);

    const vercel = readFileSync(join(repo, "vercel.json"), "utf8");
    assert.doesNotMatch(vercel, /TURSO_AUTH_TOKEN|libsql:\/\//);

    const record = makeDecision();
    const ledger = JSON.stringify(record);
    assert.doesNotMatch(ledger, /TURSO_AUTH_TOKEN|TURSO_DATABASE_URL/);

    const report: VerificationReport = {
      repository: record.repository,
      commit: record.commit,
      contract_hash: record.contract_hash,
      engine_version: record.engine_version,
      checks: [],
      decision: record,
    };
    const comment = renderPrComment(report);
    assert.doesNotMatch(comment, /TURSO_AUTH_TOKEN|TURSO_DATABASE_URL/);

    for (const file of walk(join(repo, "src"))) {
      const text = readFileSync(file, "utf8");
      assert.doesNotMatch(text, secretAssignment, file);
    }
  });

  it("keeps core free of Vercel, the Control Plane, and identity", () => {
    const core = join(repo, "src/core");
    for (const name of readdirSync(core)) {
      if (!name.endsWith(".ts")) continue;
      const text = readFileSync(join(core, name), "utf8");
      assert.doesNotMatch(text, /control-plane|vercel|src\/identity|src\/gemini/i);
    }
  });
});
