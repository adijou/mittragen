import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Exercise the deployed route handler, including its outer authentication guard.
// Identity and the database are external boundaries; profile verification and
// invitation logic stay real. The RLS suite covers the database operations.
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.includes("/@netlify/identity/dist/")) return { format: "module", shortCircuit: true, source: `
      export class AuthError extends Error {}
      export const getUser = async () => ({ id: "sponsor-account", email: "sponsor@example.invalid" });
      export const refreshSession = async () => {};
      export const getIdentityConfig = () => ({ url: "https://identity.example.invalid" });
      export const verifyRequestOrigin = request => {
        if (request.headers.get("origin") !== new URL(request.url).origin) throw new AuthError("invalid origin");
      };
    ` };
    if (url.endsWith("/netlify/functions/_shared/database.ts")) return { format: "module", shortCircuit: true, source: `
      export const isUuid = value => /^[0-9a-f-]{36}$/.test(value);
      export const withSession = async (id, tenant, operation) => operation({
        query: async sql => ({ rows: sql.includes("AS present") ? [{ present: true, workspace: false }] : [], rowCount: 0 }),
        release() {},
      });
    ` };
    return nextLoad(url, context);
  },
});
const { default: handler, config } = await import("../netlify/functions/sponsor-portal.mts");
hooks.deregister();

const context = { requestId: "test-request", cookies: { get: (name: string) => name === "nf_jwt" ? "caller-token" : undefined } };
const request = (path: string, method = "GET") => new Request(`https://mittragen.example.invalid/api/sponsor-portal${path}`, {
  method, headers: { Origin: "https://mittragen.example.invalid" },
});

test("the route resolves missing confirmation before both invitation claim and space loading", async (t) => {
  let profileReads = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://identity.example.invalid/user");
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer caller-token");
    profileReads++;
    return Response.json({ id: "sponsor-account", email: "sponsor@example.invalid", confirmed_at: "2026-09-15T06:00:00Z" });
  });
  const claim = await handler(request("/claim", "POST"), context as never);
  assert.equal(claim.status, 200);
  assert.deepEqual(await claim.json(), { claimed: 0, hasAccess: true, hasWorkspace: false });
  const spaces = await handler(request(""), context as never);
  assert.equal(spaces.status, 200);
  assert.deepEqual(await spaces.json(), { spaces: [] });
  assert.equal(profileReads, 2);
});

test("the route still rejects truly unconfirmed profiles for claim and space loading", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ id: "sponsor-account", email: "sponsor@example.invalid" }));
  for (const [path, method] of [["/claim", "POST"], ["", "GET"]]) {
    const result = await handler(request(path, method), context as never);
    assert.equal(result.status, 422);
    assert.equal((await result.json()).error, "verified_email_required");
  }
});

test("contact route enforces origin, input validation and sponsor ownership", async (t) => {
  assert.ok(config.path.includes("/api/sponsor-portal/:tenantId/:sponsorId/contact"), "Netlify must register the contact endpoint");
  t.mock.method(globalThis, "fetch", async () => Response.json({ id: "sponsor-account", email: "sponsor@example.invalid", confirmed_at: "2026-09-15T06:00:00Z" }));
  const url = "https://mittragen.example.invalid/api/sponsor-portal/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/contact";
  const contact = { legal_name: "Test Sponsor", contact_name: null, contact_email: "contact@example.invalid", phone: null };
  for (const [origin, payload, status, error] of [
    ["https://other.example.invalid", { ...contact, original: contact }, 403, "invalid_request_origin"],
    ["https://mittragen.example.invalid", { ...contact, original: contact, roles: ["admin"] }, 422, "contact_fields_only"],
    ["https://mittragen.example.invalid", { ...contact, original: contact }, 403, "sponsor_access_denied"],
  ] as const) {
    const result = await handler(new Request(url, { method: "PATCH", headers: { Origin: origin }, body: JSON.stringify(payload) }), context as never);
    assert.equal(result.status, status);
    assert.equal((await result.json()).error, error);
  }
  assert.equal((await handler(new Request(url), context as never)).status, 405);
});
