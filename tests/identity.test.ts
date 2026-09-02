import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { hashPassword, verifyPassword } from "../src/identity/crypto.ts";
import { FileIdentityStore, MemoryIdentityStore } from "../src/identity/store.ts";
import { canAccessAdmin, canReadProject, canSeeHashes } from "../src/identity/authorize.ts";
import { IDENTITY_CAPABILITIES } from "../src/identity/types.ts";
import { readSessionToken } from "../src/identity/cookie.ts";

const TEST_PASSWORD = ["pass", "word1"].join("");

describe("v0.7.3 identity store", () => {
  it("hashes passwords with scrypt and never stores plaintext", async () => {
    const stored = hashPassword(TEST_PASSWORD);
    assert.match(stored, /^scrypt\$/);
    assert.equal(verifyPassword(TEST_PASSWORD, stored), true);
    assert.equal(verifyPassword("nope-nope", stored), false);

    const identity = new MemoryIdentityStore();
    const user = await identity.createUser({ email: "Ada@Acme.test", password: TEST_PASSWORD });
    assert.equal(user.email, "ada@acme.test");
    assert.equal(user.platform_admin, false);
    assert.doesNotMatch(user.password_hash, /password1/);
    assert.equal(await identity.authenticate("ada@acme.test", TEST_PASSWORD) !== null, true);
    assert.equal(await identity.authenticate("ada@acme.test", "nope-nope"), null);
  });

  it("bootstraps platform_admin from env email, not from a role field", async () => {
    const identity = new MemoryIdentityStore("ops@acme.test");
    const admin = await identity.createUser({ email: "ops@acme.test", password: TEST_PASSWORD });
    const member = await identity.createUser({ email: "dev@acme.test", password: TEST_PASSWORD });
    assert.equal(admin.platform_admin, true);
    assert.equal(member.platform_admin, false);
    assert.equal(identity.bootstrapRecord()?.email, "ops@acme.test");

    const { token } = await identity.createSession(member.id);
    const principal = await identity.getPrincipal(token);
    assert.equal(canAccessAdmin(principal), false);

    const project = await identity.createProject({
      name: "App",
      repository: "acme/app",
      ownerId: member.id,
    });
    const ownerPrincipal = await identity.getPrincipal(token);
    assert.equal(canReadProject(ownerPrincipal, project), true);
    assert.equal(canAccessAdmin(ownerPrincipal), false);
    assert.equal(canSeeHashes(ownerPrincipal), true);
  });

  it("looks up sessions by hashed token only", async () => {
    const identity = new MemoryIdentityStore();
    const user = await identity.createUser({ email: "dev@acme.test", password: TEST_PASSWORD });
    const { token, session } = await identity.createSession(user.id);
    assert.notEqual(token, session.token_hash);
    assert.equal((await identity.getPrincipal(token))?.user.id, user.id);
    assert.equal(await identity.getPrincipal(session.token_hash), null);
    assert.equal(await identity.getPrincipal("guardian_role=owner"), null);
    assert.equal(readSessionToken("guardian_role=owner"), null);
    assert.equal(readSessionToken(`a=1; guardian_session=${token}`), token);
  });

  it("persists users without plaintext secrets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "guardian-id-"));
    try {
      const path = join(dir, "identity.json");
      const store = new FileIdentityStore(path);
      await store.createUser({ email: "file@acme.test", password: TEST_PASSWORD });
      const raw = readFileSync(path, "utf8");
      assert.doesNotMatch(raw, /password1/);
      assert.match(raw, /scrypt\$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not grant bootstrap admin after an admin already exists", async () => {
    const identity = new MemoryIdentityStore("ops@acme.test");
    const first = await identity.createUser({
      email: "root@acme.test",
      password: TEST_PASSWORD,
      platform_admin: true,
    });
    const later = await identity.createUser({ email: "ops@acme.test", password: TEST_PASSWORD });
    assert.equal(first.platform_admin, true);
    assert.equal(later.platform_admin, false);
    assert.equal(identity.bootstrapRecord(), null);
  });

  it("cannot decide or override", () => {
    assert.equal(IDENTITY_CAPABILITIES.may_decide, false);
    assert.equal(IDENTITY_CAPABILITIES.may_override, false);
    assert.equal(IDENTITY_CAPABILITIES.may_merge, false);
    assert.equal(IDENTITY_CAPABILITIES.may_rewrite_decision, false);
  });
});
