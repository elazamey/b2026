import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { decide } from "../src/core/decision-engine.ts";
import { validateContract } from "../src/core/contract-engine.ts";
import { MemoryControlPlaneReader } from "../src/control-plane/reader.ts";
import { IDENTITY_CAPABILITIES } from "../src/identity/types.ts";
import { MemoryIdentityStore } from "../src/identity/store.ts";
import { handleSiteRequest } from "../src/web/router.ts";
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

const TEST_PASSWORD = ["pass", "word1"].join("");

async function session(
  identity: MemoryIdentityStore,
  options: { email: string; platform_admin?: boolean; repository?: string },
): Promise<{ cookie: string }> {
  const user = await identity.createUser({
    email: options.email,
    password: TEST_PASSWORD,
    platform_admin: options.platform_admin,
  });
  const { token } = await identity.createSession(user.id);
  if (options.repository) {
    await identity.createProject({
      name: options.repository,
      repository: options.repository,
      ownerId: user.id,
    });
  }
  return { cookie: `guardian_session=${token}` };
}

describe("v0.7.2 public product UI with identity", () => {
  it("never grants override or merge to identity", () => {
    assert.equal(IDENTITY_CAPABILITIES.may_override, false);
    assert.equal(IDENTITY_CAPABILITIES.may_decide, false);
    assert.equal(IDENTITY_CAPABILITIES.may_merge, false);
  });

  it("serves marketing at / and keeps admin behind platform_admin", async () => {
    const reader = new MemoryControlPlaneReader([makeDecision()]);
    const identity = new MemoryIdentityStore();
    const home = await handleSiteRequest({ method: "GET", url: "/" }, reader, identity);
    assert.equal(home.status, 200);
    assert.match(home.body, /The coding agent builds/);
    assert.doesNotMatch(home.body, /\[Override\]|Approve anyway|name="result"/i);

    const login = await handleSiteRequest({ method: "GET", url: "/login" }, reader, identity);
    assert.doesNotMatch(login.body, /name="role"/);

    const user = await session(identity, { email: "user@acme.test" });
    const userAdmin = await handleSiteRequest(
      { method: "GET", url: "/admin", headers: { cookie: user.cookie } },
      reader,
      identity,
    );
    assert.equal(userAdmin.status, 403);

    const admin = await session(identity, { email: "admin@acme.test", platform_admin: true });
    const ownerAdmin = await handleSiteRequest(
      { method: "GET", url: "/admin/decisions?format=json", headers: { cookie: admin.cookie } },
      reader,
      identity,
    );
    assert.equal(ownerAdmin.status, 200);
    const payload = JSON.parse(ownerAdmin.body) as { writable: boolean };
    assert.equal(payload.writable, false);
  });

  it("shows own project health without an override control", async () => {
    const rejected = makeDecision("REJECTED");
    const reader = new MemoryControlPlaneReader([rejected]);
    const identity = new MemoryIdentityStore();
    const user = await session(identity, { email: "dev@acme.test", repository: "acme/app" });
    const page = await handleSiteRequest(
      { method: "GET", url: "/app/projects", headers: { cookie: user.cookie } },
      reader,
      identity,
    );
    assert.equal(page.status, 200);
    assert.match(page.body, /REJECTED|⚠/);
    assert.doesNotMatch(page.body, /\[Override\]|Approve anyway|name="result"/i);
  });

  it("keeps login from changing a sealed decision and ignores role fields", async () => {
    const record = makeDecision("REJECTED");
    const reader = new MemoryControlPlaneReader([record]);
    const identity = new MemoryIdentityStore();
    await identity.createUser({ email: "dev@acme.com", password: TEST_PASSWORD });
    const response = await handleSiteRequest(
      {
        method: "POST",
        url: "/login",
        body: `email=dev@acme.com&password=${TEST_PASSWORD}&role=owner`,
      },
      reader,
      identity,
    );
    assert.equal(response.status, 303);
    assert.match(response.headers["set-cookie"] ?? "", /guardian_session=/);
    assert.doesNotMatch(response.headers["set-cookie"] ?? "", /guardian_role=/);
    assert.equal((await reader.getDecision(record.decision_id))?.result, "REJECTED");

    const cookie = response.headers["set-cookie"] ?? "";
    const admin = await handleSiteRequest(
      { method: "GET", url: "/admin", headers: { cookie } },
      reader,
      identity,
    );
    assert.equal(admin.status, 403);
  });

  it("rejects cookie tampering as a path to admin", async () => {
    const reader = new MemoryControlPlaneReader([makeDecision()]);
    const identity = new MemoryIdentityStore();
    const forgedRole = await handleSiteRequest(
      { method: "GET", url: "/admin", headers: { cookie: "guardian_role=owner" } },
      reader,
      identity,
    );
    assert.equal(forgedRole.status, 403);

    const forgedSession = await handleSiteRequest(
      { method: "GET", url: "/admin", headers: { cookie: "guardian_session=deadbeef" } },
      reader,
      identity,
    );
    assert.equal(forgedSession.status, 403);

    const app = await handleSiteRequest(
      { method: "GET", url: "/app", headers: { cookie: "guardian_role=user" } },
      reader,
      identity,
    );
    assert.equal(app.status, 303);
    assert.equal(app.headers.location, "/login");
  });

  it("lets a user create a project without mutating Guardian", async () => {
    const record = makeDecision("REJECTED");
    const reader = new MemoryControlPlaneReader([record]);
    const identity = new MemoryIdentityStore();
    const user = await session(identity, { email: "owner@acme.test" });
    const post = await handleSiteRequest(
      {
        method: "POST",
        url: "/app/projects",
        headers: { cookie: user.cookie },
        body: "name=App&repository=acme/app",
      },
      reader,
      identity,
    );
    assert.equal(post.status, 303);
    assert.match(post.headers.location ?? "", /\/app\/projects\//);
    assert.equal((await reader.getDecision(record.decision_id))?.result, "REJECTED");

    const scans = await handleSiteRequest(
      { method: "POST", url: "/app/scans", headers: { cookie: user.cookie } },
      reader,
      identity,
    );
    assert.equal(scans.status, 405);

    const adminPost = await handleSiteRequest(
      { method: "POST", url: `/admin/decision/${record.decision_id}`, headers: { cookie: user.cookie } },
      reader,
      identity,
    );
    assert.equal(adminPost.status, 403);
  });

  it("hides other users' Guardian results", async () => {
    const record = makeDecision("REJECTED");
    const reader = new MemoryControlPlaneReader([record]);
    const identity = new MemoryIdentityStore();
    await session(identity, { email: "a@acme.test", repository: "acme/app" });
    const stranger = await session(identity, { email: "b@acme.test" });
    const page = await handleSiteRequest(
      { method: "GET", url: "/app/projects", headers: { cookie: stranger.cookie } },
      reader,
      identity,
    );
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.body, /acme\/app/);
    assert.doesNotMatch(page.body, /REJECTED/);
  });

  it("does not import the decision engine", () => {
    for (const dir of ["web", "identity"]) {
      const root = join(import.meta.dirname, `../src/${dir}`);
      for (const name of readdirSync(root)) {
        if (!name.endsWith(".ts")) continue;
        const source = readFileSync(join(root, name), "utf8");
        assert.doesNotMatch(source, /decision-engine/);
        assert.doesNotMatch(source, /verification-engine/);
        assert.doesNotMatch(source, /saveDecision/);
      }
    }
  });
});
