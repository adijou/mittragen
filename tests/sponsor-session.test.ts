import assert from "node:assert/strict";
import test from "node:test";
import type { CallbackResult, User } from "@netlify/identity";
import { createIdentityInitializer, IdentityAccountSwitchRequired, confirmedAccessDestination } from "../src/identityFeedback.ts";
import { accountScopedFetch, createSponsorLoadGuard } from "../src/sponsorSession.ts";
import { readSponsorTarget, sponsorSpacePath } from "../shared/sponsor-space-link.ts";
import { prepareSponsorAccess, readSponsorEntry } from "../src/sponsorAccess.ts";

const oldUser: User = { id: "account-a", email: "a@example.invalid", confirmedAt: "2026-09-15T01:00:00Z" };
const newUser: User = { ...oldUser, id: "account-b", email: "b@example.invalid" };

test("a personal link never redeems a token or loads an existing account before an explicit account switch", async () => {
  for (const callbackKind of ["confirmation", "invite", "recovery", "oauth"] as const) {
    let current: User | null = oldUser; let redeemed = 0;
    const deps = { callbackKind, checkSettings: async () => {}, getUser: async () => current,
      refreshSession: async () => { throw new Error("must not refresh old session"); },
      handleCallback: async (): Promise<CallbackResult> => { redeemed++; return { type: "confirmation", user: newUser }; } };
    const blocked = createIdentityInitializer(deps);
    for (const call of [blocked(), blocked()]) await assert.rejects(call,
      (error: unknown) => error instanceof IdentityAccountSwitchRequired && error.currentUser === oldUser);
    assert.equal(redeemed, 0);
    current = null; // logout must succeed before a new initializer is created
    const resumed = createIdentityInitializer(deps);
    const results = await Promise.all([resumed(), resumed()]);
    assert.equal(redeemed, 1);
    assert.equal(results[0].user, newUser);
    assert.equal(results[0], results[1]);
  }
});

test("invitation password entry never inherits a previously cached user", async () => {
  let oldReads = 0;
  const result = await createIdentityInitializer({ checkSettings: async () => {},
    handleCallback: async () => ({ type: "invite", user: null, token: "dummy-token" }),
    refreshSession: async () => {}, getUser: async () => { oldReads++; return oldUser; },
  })();
  assert.equal(result.user, null); assert.equal(oldReads, 0);
});

test("sponsor target survives login and incomplete links never downgrade to a generic space", () => {
  const target = { tenantId: "11111111-1111-4111-8111-111111111111", sponsorId: "22222222-2222-4222-8222-222222222222" };
  const entries = new Map();
  const storage = { setItem: (k: string, v: string) => entries.set(k, v), getItem: (k: string) => entries.get(k) ?? null } as Storage;
  const parsed = readSponsorTarget(new URL(sponsorSpacePath(target), "https://example.invalid").search);
  assert.deepEqual(parsed, target);
  prepareSponsorAccess({ mode: "login", target: parsed }, storage);
  assert.deepEqual(readSponsorEntry(storage)?.target, target);
  assert.deepEqual(readSponsorTarget("?sponsor=invalid"), { tenantId: "", sponsorId: "invalid" });
  assert.equal(readSponsorTarget(""), undefined);
});

test("destination checks pin the authenticated account, recipient and requested sponsor", async () => {
  const target = { tenantId: "tenant-b", sponsorId: "sponsor-b" };
  await assert.rejects(confirmedAccessDestination(true, async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("X-Sponsor-Account"), newUser.id);
    assert.deepEqual(JSON.parse(String(init?.body)), { target, expectedEmail: newUser.email });
    return Response.json({ error: "sponsor_link_access_denied" }, { status: 403 });
  }, { accountId: newUser.id, email: newUser.email, target }), /sponsor_link_access_denied/);
});

test("cross-tab account changes clear the view for reads and writes without swallowing the rejection", async () => {
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    let cleared = 0;
    const fetcher = accountScopedFetch(oldUser.id, () => { cleared++; }, async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("X-Sponsor-Account"), oldUser.id);
      assert.equal(init?.method, method);
      return Response.json({ error: "sponsor_account_changed" }, { status: 409 });
    });
    const result = await fetcher("/api/sponsor-portal", { method });
    assert.equal(cleared, 1); assert.equal(result.status, 409);
    assert.equal((await result.json()).error, "sponsor_account_changed");
  }
});

test("late space requests cannot restore cached data after logout or a newer load", async () => {
  const guard = createSponsorLoadGuard(); let displayed = "";
  let release!: () => void;
  const isCurrent = guard.begin();
  const pending = new Promise<void>((resolve) => { release = resolve; }).then(() => { if (isCurrent()) displayed = "old sponsor"; });
  guard.invalidate(); release(); await pending;
  assert.equal(displayed, "");
  const oldLoad = guard.begin(); const newLoad = guard.begin();
  assert.equal(oldLoad(), false); assert.equal(newLoad(), true);
});

test("responses and callbacks from an abandoned page cannot deliver documents or affect a new session", async () => {
  let current = true; let deliver!: (response: Response) => void; let changed = 0;
  const fetcher = accountScopedFetch(oldUser.id, () => { changed++; },
    async () => new Promise<Response>((resolve) => { deliver = resolve; }), () => current);
  const pending = fetcher("/api/contracts/test/pdf");
  current = false;
  deliver(new Response("private document"));
  await assert.rejects(pending, /sponsor_account_changed/);
  await assert.rejects(fetcher("/api/contracts/test/pdf"), /sponsor_account_changed/);
  assert.equal(changed, 0);
});
