import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { decide } from "../src/core/decision-engine.ts";
import { validateContract } from "../src/core/contract-engine.ts";
import { MemoryControlPlaneReader } from "../src/control-plane/reader.ts";
import { MemoryIdentityStore } from "../src/identity/store.ts";
import { GEMINI_CAPABILITIES, isReviewSkip } from "../src/gemini/types.ts";
import { createGeminiReviewer } from "../src/gemini/client.ts";
import { MemoryReviewStore } from "../src/gemini/store.ts";
import { sanitizeReview } from "../src/gemini/sanitize.ts";
import { handleSiteRequest } from "../src/web/router.ts";
import type { PlaneResponse } from "../src/control-plane/http.ts";
import type { CheckResult, DecisionRecord } from "../src/types.ts";

const TEST_PASSWORD = ["pass", "word1"].join("");

function check(name: CheckResult["name"], status: CheckResult["status"], failId?: string): CheckResult {
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

function makeDecision(result: DecisionRecord["result"] = "REJECTED"): DecisionRecord {
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

function cookieHeader(headers: PlaneResponse["headers"]): string {
  const raw = headers["set-cookie"];
  if (Array.isArray(raw)) return raw.join("; ");
  return raw ?? "";
}

describe("v0.8 Gemini advisory reviewer", () => {
  it("cannot decide, merge, or override", () => {
    assert.equal(GEMINI_CAPABILITIES.may_decide, false);
    assert.equal(GEMINI_CAPABILITIES.may_merge, false);
    assert.equal(GEMINI_CAPABILITIES.may_override, false);
    assert.equal(GEMINI_CAPABILITIES.authority, "advisory");
  });

  it("strips a model result field and never stores SAFE_TO_MERGE as authority", () => {
    const review = sanitizeReview({
      decisionId: "dg_test",
      model: "gemini-2.0-flash",
      raw: {
        result: "SAFE_TO_MERGE",
        risk: "low",
        explanation: "Looks fine",
        repair_plan: ["do not merge from this text"],
      },
    });
    assert.equal(review.authority, "advisory");
    assert.equal(review.decision_id, "dg_test");
    assert.equal("result" in review, false);
    assert.notEqual(review.authority, "SAFE_TO_MERGE");
  });

  it("skips when Gemini is off and leaves the Guardian decision unchanged", async () => {
    const decision = makeDecision("REJECTED");
    const reviewer = createGeminiReviewer({ env: {}, disabled: false });
    const skipped = await reviewer.review(decision);
    assert.equal(isReviewSkip(skipped), true);
    if (isReviewSkip(skipped)) assert.equal(skipped.reason, "no_key");
    assert.equal(decision.result, "REJECTED");

    const passed = makeDecision("SAFE_TO_MERGE");
    const skipPass = await createGeminiReviewer({
      env: { GEMINI_API_KEY: ["not", "a-real-key"].join("-") },
    }).review(passed);
    assert.equal(isReviewSkip(skipPass), true);
    if (isReviewSkip(skipPass)) assert.equal(skipPass.reason, "not_rejected");
    assert.equal(passed.result, "SAFE_TO_MERGE");
  });

  it("records an advisory review from a mock model without changing result", async () => {
    const decision = makeDecision("REJECTED");
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      result: "SAFE_TO_MERGE",
                      risk: "high",
                      explanation: "Fix the security finding.",
                      repair_plan: ["repair in a new commit"],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    const reviewer = createGeminiReviewer({
      env: { GEMINI_API_KEY: ["not", "a-real-key"].join("-") },
      fetchImpl,
    });
    const review = await reviewer.review(decision);
    assert.equal(isReviewSkip(review), false);
    if (isReviewSkip(review)) return;
    assert.equal(review.authority, "advisory");
    assert.equal(review.risk, "high");
    assert.equal("result" in review, false);
    assert.equal(decision.result, "REJECTED");
    const store = new MemoryReviewStore();
    await store.save(review);
    assert.equal((await store.getByDecision(decision.decision_id))?.authority, "advisory");
  });

  it("exposes POST /api/reviews as advisory and 503 when Gemini is off", async () => {
    const record = makeDecision("REJECTED");
    const reader = new MemoryControlPlaneReader([record]);
    const identity = new MemoryIdentityStore();
    const user = await identity.createUser({ email: "dev@acme.test", password: TEST_PASSWORD });
    const { token } = await identity.createSession(user.id);
    await identity.createProject({ name: "App", repository: "acme/app", ownerId: user.id });
    const login = await handleSiteRequest({ method: "GET", url: "/login" }, reader, identity);
    const csrf = login.body.match(/name="csrf" value="([^"]+)"/)?.[1] ?? "";
    const cookie = [`guardian_session=${token}`, cookieHeader(login.headers)].join("; ");

    const off = await handleSiteRequest(
      {
        method: "POST",
        url: `/api/reviews/${record.decision_id}`,
        headers: { cookie },
        body: `csrf=${csrf}`,
      },
      reader,
      identity,
    );
    assert.equal(off.status, 503);
    const payload = JSON.parse(off.body) as { authority: string; decision_result: string };
    assert.equal(payload.authority, "advisory");
    assert.equal(payload.decision_result, "REJECTED");
    assert.equal((await reader.getDecision(record.decision_id))?.result, "REJECTED");

    const stranger = await identity.createUser({ email: "other@acme.test", password: TEST_PASSWORD });
    const other = await identity.createSession(stranger.id);
    const stolen = await handleSiteRequest(
      {
        method: "GET",
        url: `/api/reviews/${record.decision_id}`,
        headers: { cookie: `guardian_session=${other.token}` },
      },
      reader,
      identity,
    );
    assert.equal(stolen.status, 404);
  });

  it("does not import the decision engine", () => {
    const dir = join(import.meta.dirname, "../src/gemini");
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts")) continue;
      const source = readFileSync(join(dir, name), "utf8");
      assert.doesNotMatch(source, /decision-engine/);
      assert.doesNotMatch(source, /verification-engine/);
      assert.doesNotMatch(source, /saveDecision/);
    }
  });
});
