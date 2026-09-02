import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { decide } from "../src/core/decision-engine.ts";
import { validateContract } from "../src/core/contract-engine.ts";
import { MemoryControlPlaneReader } from "../src/control-plane/reader.ts";
import { handleSiteRequest } from "../src/web/router.ts";
import { ROLE_CAPABILITIES } from "../src/web/roles.ts";
import type { CheckResult, DecisionRecord } from "../src/types.ts";

function check(
  name: CheckResult["name"],
  status: CheckResult["status"],
  failId?: string,
): CheckResult {
  return {
    name,
    status,
    findings:
      status === "FAIL" && failId
        ? [{ id: failId, rule: name, severity: "error", message: `${name} failed`, file: "src/x.ts" }]
        : [],
    evidence: { violations: status === "FAIL" ? 1 : 0 },
    duration_ms: 1,
  };
}

function makeDecision(result: DecisionRecord["result"] = "SAFE_TO_MERGE"): DecisionRecord {
  const fail = result === "REJECTED";
  const contract = validateContract({
    version: "1",
    project: { type: "node" },
    merge: { require: ["security"] },
  });
  const record = decide({
    checks: [
      check("architecture", "PASS"),
      check("dependencies", "PASS"),
      check("security", fail ? "FAIL" : "PASS", fail ? "SEC-001" : undefined),
      check("boundaries", "PASS"),
      check("tests", "PASS"),
      check("build", "SKIP"),
    ],
    contract,
    repository: "acme/app",
    commit: "abc1234",
    commitSha: "abc1234deadbeef",
    contractHash: "sha256:contract",
    contractPath: "architecture.yaml",
  });
  return { ...record, result };
}

describe("v0.7.1 public product UI", () => {
  it("never grants override or merge to any role", () => {
    assert.equal(ROLE_CAPABILITIES.may_override, false);
    assert.equal(ROLE_CAPABILITIES.may_decide, false);
    assert.equal(ROLE_CAPABILITIES.may_merge, false);
  });

  it("serves marketing at / and keeps admin on /admin", async () => {
    const reader = new MemoryControlPlaneReader([makeDecision()]);
    const home = await handleSiteRequest({ method: "GET", url: "/" }, reader);
    assert.equal(home.status, 200);
    assert.match(home.body, /The coding agent builds/);
    assert.doesNotMatch(home.body, /\[Override\]|Approve anyway|name="result"/i);

    const userAdmin = await handleSiteRequest(
      { method: "GET", url: "/admin", headers: { cookie: "guardian_role=user" } },
      reader,
    );
    assert.equal(userAdmin.status, 403);

    const ownerAdmin = await handleSiteRequest(
      { method: "GET", url: "/admin/decisions?format=json", headers: { cookie: "guardian_role=owner" } },
      reader,
    );
    assert.equal(ownerAdmin.status, 200);
    const payload = JSON.parse(ownerAdmin.body) as { writable: boolean };
    assert.equal(payload.writable, false);
  });

  it("shows project health without an override control", async () => {
    const rejected = makeDecision("REJECTED");
    const reader = new MemoryControlPlaneReader([rejected]);
    const page = await handleSiteRequest(
      { method: "GET", url: "/app/projects", headers: { cookie: "guardian_role=user" } },
      reader,
    );
    assert.equal(page.status, 200);
    assert.match(page.body, /REJECTED|⚠/);
    assert.doesNotMatch(page.body, /\[Override\]|Approve anyway|name="result"/i);
  });

  it("keeps login from changing a sealed decision", async () => {
    const record = makeDecision("REJECTED");
    const reader = new MemoryControlPlaneReader([record]);
    const response = await handleSiteRequest(
      { method: "POST", url: "/login", body: "email=dev@acme.com&role=developer" },
      reader,
    );
    assert.equal(response.status, 303);
    assert.match(response.headers["set-cookie"] ?? "", /guardian_role=developer/);
    assert.equal((await reader.getDecision(record.decision_id))?.result, "REJECTED");
  });

  it("blocks users from admin and mutations on /app", async () => {
    const record = makeDecision("REJECTED");
    const reader = new MemoryControlPlaneReader([record]);
    const post = await handleSiteRequest(
      { method: "POST", url: "/app/projects", headers: { cookie: "guardian_role=user" } },
      reader,
    );
    assert.equal(post.status, 405);
    const adminPost = await handleSiteRequest(
      { method: "POST", url: `/admin/decision/${record.decision_id}`, headers: { cookie: "guardian_role=owner" } },
      reader,
    );
    assert.equal(adminPost.status, 405);
    assert.equal((await reader.getDecision(record.decision_id))?.result, "REJECTED");
  });

  it("does not import the decision engine", () => {
    const dir = join(import.meta.dirname, "../src/web");
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts")) continue;
      const source = readFileSync(join(dir, name), "utf8");
      assert.doesNotMatch(source, /decision-engine/);
      assert.doesNotMatch(source, /verification-engine/);
      assert.doesNotMatch(source, /saveDecision/);
    }
  });
});
