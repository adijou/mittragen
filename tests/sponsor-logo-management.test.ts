import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MAX_LOGO_BYTES, validateLogoUpload } from "../netlify/functions/_shared/logo-upload.ts";

test("sponsor logo validation rejects deceptive sizes and non-images", async () => {
  assert.deepEqual(await validateLogoUpload({
    size: MAX_LOGO_BYTES + 1,
    arrayBuffer: async () => new ArrayBuffer(8),
  }), { ok: false, error: "invalid_logo_size" });
  assert.deepEqual(await validateLogoUpload({
    size: 8,
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer,
  }), { ok: false, error: "invalid_logo_type" });
  assert.deepEqual(await validateLogoUpload({
    size: 8,
    arrayBuffer: async () => new ArrayBuffer(9),
  }), { ok: false, error: "invalid_logo_size" });
});

test("sponsor logo routes are account-bound, audited and private", async () => {
  const source = await readFile(new URL("../netlify/functions/_shared/sponsor-logo.ts", import.meta.url), "utf8");
  assert.match(source, /JOIN sponsor_portal_access access/);
  assert.match(source, /access\.identity_user_id = \$3/);
  assert.match(source, /verifyMutation\(request\)/);
  assert.match(source, /validateLogoUpload/);
  assert.match(source, /sponsor-logos\/\$\{tenantId\}\/\$\{sponsorId\}/);
  assert.match(source, /'sponsor\.logo_updated'/);
  assert.match(source, /'sponsor\.logo_deleted'/);
  assert.match(source, /"Cache-Control": "private, no-store"/);
  assert.match(source, /FOR UPDATE OF sponsor/);
});

test("logo management lives in the protected sponsor portal", async () => {
  const portal = await readFile(new URL("../src/SponsorPortal.tsx", import.meta.url), "utf8");
  const checkout = await readFile(new URL("../src/SponsoringCheckoutPublic.tsx", import.meta.url), "utf8");
  assert.match(portal, /Sponsorlogo verwalten/);
  assert.match(portal, /type="file" accept="image\/png,image\/jpeg"/);
  assert.match(portal, /Logo entfernen/);
  assert.match(portal, /\/api\/sponsor-portal\/\$\{space\.tenantId\}\/\$\{space\.sponsor\.id\}\/logo/);
  assert.doesNotMatch(checkout, /Logo hochladen|Sponsorlogo verwalten|type="file"/);
});
