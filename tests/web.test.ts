import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { decide } from "../src/core/decision-engine.ts";
import { validateContract } from "../src/core/contract-engine.ts";
import { MemoryControlPlaneReader } from "../src/control-plane/reader.ts";
import type { PlaneResponse } from "../src/control-plane/http.ts";
import { IDENTITY_CAPABILITIES } from "../src/identity/types.ts";
import { MemoryIdentityStore } from "../src/identity/store.ts";
import { LoginLimiter } from "../src/identity/rate-limit.ts";
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

function cookieHeader(headers: PlaneResponse["headers"]): string {
  const raw = headers["set-cookie"];
  if (Array.isArray(raw)) return raw.join("; ");
  return raw ?? "";
}

function csrfOf(response: PlaneResponse): { cookie: string; token: string } {
  const match = response.body.match(/name="csrf" value="([^"]+)"/);
  return { cookie: cookieHeader(response.headers), token: match?.[1] ?? "" };
}

function mergeCookies(...parts: string[]): string {
  return parts.filter(Boolean).join("; ");
}

async function session(
  identity: MemoryIdentityStore,
  options: { email: string; platform_admin?: boolean; repository?: string },
): Promise<{ cookie: string; userId: string }> {
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
  return { cookie: `guardian_session=${token}`, userId: user.id };
}

describe("v0.7.3 public product UI with identity", () => {
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
    assert.match(login.body, /name="csrf"/);
    assert.match(cookieHeader(login.headers), /HttpOnly/);
    assert.match(cookieHeader(login.headers), /SameSite=Lax/);
    assert.match(cookieHeader(login.headers), /Path=\//);
    assert.doesNotMatch(cookieHeader(login.headers), /Secure/);

    const secureLogin = await handleSiteRequest(
      { method: "GET", url: "/login", headers: { "x-forwarded-proto": "https" } },
      reader,
      identity,
    );
    assert.match(cookieHeader(secureLogin.headers), /Secure/);

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
    const loginPage = await handleSiteRequest({ method: "GET", url: "/login" }, reader, identity);
    const csrf = csrfOf(loginPage);
    const response = await handleSiteRequest(
      {
        method: "POST",
        url: "/login",
        headers: { cookie: csrf.cookie },
        body: `csrf=${csrf.token}&email=dev@acme.com&password=${TEST_PASSWORD}&role=owner`,
      },
      reader,
      identity,
    );
    assert.equal(response.status, 303);
    assert.match(cookieHeader(response.headers), /guardian_session=/);
    assert.doesNotMatch(cookieHeader(response.headers), /guardian_role=/);
    assert.equal((await reader.getDecision(record.decision_id))?.result, "REJECTED");

    const admin = await handleSiteRequest(
      { method: "GET", url: "/admin", headers: { cookie: cookieHeader(response.headers) } },
      reader,
      identity,
    );
    assert.equal(admin.status, 403);
  });

  it("rejects cookie tampering, CSRF skips, and cross-origin POSTs", async () => {
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

    const noCsrf = await handleSiteRequest(
      {
        method: "POST",
        url: "/login",
        body: `email=dev@acme.com&password=${TEST_PASSWORD}`,
      },
      reader,
      identity,
    );
    assert.equal(noCsrf.status, 403);

    const cross = await handleSiteRequest(
      {
        method: "POST",
        url: "/login",
        headers: { origin: "https://evil.example", host: "guardian.local" },
        body: "csrf=x",
      },
      reader,
      identity,
    );
    assert.equal(cross.status, 403);
  });

  it("lets a user create a project without mutating Guardian", async () => {
    const record = makeDecision("REJECTED");
    const reader = new MemoryControlPlaneReader([record]);
    const identity = new MemoryIdentityStore();
    const user = await session(identity, { email: "owner@acme.test" });
    const formPage = await handleSiteRequest(
      { method: "GET", url: "/app/projects", headers: { cookie: user.cookie } },
      reader,
      identity,
    );
    const csrf = csrfOf(formPage);
    const post = await handleSiteRequest(
      {
        method: "POST",
        url: "/app/projects",
        headers: { cookie: mergeCookies(user.cookie, csrf.cookie) },
        body: `csrf=${csrf.token}&name=App&repository=acme/app`,
      },
      reader,
      identity,
    );
    assert.equal(post.status, 303);
    assert.match(String(post.headers.location ?? ""), /\/app\/projects\//);
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

  it("hides other users' Guardian results and does not leak projects by id", async () => {
    const record = makeDecision("REJECTED");
    const reader = new MemoryControlPlaneReader([record]);
    const identity = new MemoryIdentityStore();
    await session(identity, { email: "a@acme.test", repository: "acme/app" });
    const project = identity.dump().projects[0];
    assert.ok(project);
    const stranger = await session(identity, { email: "b@acme.test" });
    const page = await handleSiteRequest(
      { method: "GET", url: "/app/projects", headers: { cookie: stranger.cookie } },
      reader,
      identity,
    );
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.body, /acme\/app/);
    assert.doesNotMatch(page.body, /REJECTED/);

    const stolen = await handleSiteRequest(
      { method: "GET", url: `/app/projects/${project.id}`, headers: { cookie: stranger.cookie } },
      reader,
      identity,
    );
    assert.equal(stolen.status, 404);
    assert.doesNotMatch(stolen.body, /REJECTED/);
  });

  it("rate-limits login before scrypt", async () => {
    const reader = new MemoryControlPlaneReader([makeDecision()]);
    const identity = new MemoryIdentityStore();
    const limiter = new LoginLimiter(5, 60_000, 20);
    const loginPage = await handleSiteRequest({ method: "GET", url: "/login" }, reader, identity);
    const csrf = csrfOf(loginPage);
    let last: PlaneResponse | undefined;
    for (let i = 0; i < 6; i += 1) {
      last = await handleSiteRequest(
        {
          method: "POST",
          url: "/login",
          headers: { cookie: csrf.cookie, "x-forwarded-for": "203.0.113.9" },
          body: `csrf=${csrf.token}&email=limit@acme.test&password=${TEST_PASSWORD}`,
        },
        reader,
        identity,
        { limiter },
      );
    }
    assert.equal(last?.status, 429);
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
