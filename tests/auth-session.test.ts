import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createIdentityInitializer } from "../src/identityFeedback.ts";

test("server authorization refreshes near-expired Identity sessions before reading the user", async () => {
  const source = await readFile(new URL("../netlify/functions/_shared/auth.ts", import.meta.url), "utf8");
  const refreshPosition = source.indexOf("await refreshSession()");
  const userPosition = source.indexOf("await getUser()", refreshPosition);
  assert.notEqual(refreshPosition, -1);
  assert.ok(userPosition > refreshPosition);
});

test("workspace hydration refreshes a persisted browser session before exposing the user", async () => {
  const calls: string[] = [];
  const user = { id: "existing-account", email: "member@example.invalid" };
  const initialize = createIdentityInitializer({
    checkSettings: async () => { calls.push("settings"); },
    handleCallback: async () => { calls.push("callback"); return null; },
    refreshSession: async () => { calls.push("refresh"); },
    getUser: async () => { calls.push("user"); return user; },
  });
  assert.equal((await initialize()).user, user);
  assert.deepEqual(calls, ["settings", "callback", "refresh", "user"]);
  const source = await readFile(new URL("../src/ProductiveAccess.tsx", import.meta.url), "utf8");
  assert.match(source, /reason\.message === "authentication_required"/);
});
