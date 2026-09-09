import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("server authorization refreshes near-expired Identity sessions before reading the user", async () => {
  const source = await readFile(new URL("../netlify/functions/_shared/auth.ts", import.meta.url), "utf8");
  const refreshPosition = source.indexOf("await refreshSession()");
  const userPosition = source.indexOf("await getUser()", refreshPosition);
  assert.notEqual(refreshPosition, -1);
  assert.ok(userPosition > refreshPosition);
});

test("workspace hydration refreshes a persisted browser session before exposing the user", async () => {
  const source = await readFile(new URL("../src/ProductiveAccess.tsx", import.meta.url), "utf8");
  const callbackPosition = source.indexOf("const callbackResult = await handleAuthCallback()");
  const refreshPosition = source.indexOf("await refreshSession()", callbackPosition);
  const userPosition = source.indexOf("setUser(callbackResult?.user ?? await getUser())", refreshPosition);
  assert.ok(callbackPosition >= 0);
  assert.ok(refreshPosition > callbackPosition);
  assert.ok(userPosition > refreshPosition);
  assert.match(source, /reason\.message === "authentication_required"/);
});
