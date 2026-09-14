import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import type { CallbackResult, User } from "@netlify/identity";
import { confirmedAccessDestination, confirmedEmailCallback, createIdentityInitializer, identityCallbackKind, identityErrorMessage } from "../src/identityFeedback.ts";

const verified: User = { id: "test-account", email: "sponsor@example.invalid", confirmedAt: "2026-09-14T12:00:00Z" };

test("confirmation callbacks are recognized on the home page and with reordered URL fragments", () => {
  for (const url of ["https://example.invalid/#confirmation_token=test-token", "https://example.invalid/login/#other=value&confirmation_token=test-token"]) {
    assert.equal(identityCallbackKind(new URL(url).hash), "confirmation");
  }
  assert.equal(identityCallbackKind("#confirmation_token="), "confirmation");
  assert.equal(identityCallbackKind("#error=access_denied&error_description=invalid"), "error");
  assert.equal(identityCallbackKind("#invite_token=test"), "invite");
  assert.equal(identityCallbackKind("#recovery_token=test"), "recovery");
  assert.equal(identityCallbackKind("#email_change_token=test"), "email_change");
  assert.equal(identityCallbackKind("#access_token=test&refresh_token=test"), "oauth");
  assert.equal(identityCallbackKind("#sponsoring"), null);
  assert.equal(identityCallbackKind(""), null);
});

test("only a verified confirmation result can display a confirmation success", () => {
  assert.equal(confirmedEmailCallback({ type: "confirmation", user: verified }), verified);
  for (const callback of [null, { type: "confirmation", user: null },
    { type: "confirmation", user: { ...verified, confirmedAt: undefined } },
    { type: "confirmation", user: { ...verified, email: undefined } },
    { type: "oauth", user: verified }, { type: "invite", user: verified }]) {
    assert.equal(confirmedEmailCallback(callback as CallbackResult | null), null);
  }
});

test("two initialization subscribers redeem a one-time confirmation token exactly once", async () => {
  let settingsCalls = 0; let callbackCalls = 0; let refreshCalls = 0; let userCalls = 0;
  const initialize = createIdentityInitializer({
    checkSettings: async () => { settingsCalls++; },
    handleCallback: async () => { callbackCalls++; return { type: "confirmation", user: verified }; },
    refreshSession: async () => { refreshCalls++; },
    getUser: async () => { userCalls++; return null; },
  });
  const [first, second] = await Promise.all([initialize(), initialize()]);
  assert.equal(first, second);
  assert.equal(first.user, verified);
  assert.equal(settingsCalls, 1);
  assert.equal(callbackCalls, 1);
  assert.equal(refreshCalls, 0);
  assert.equal(userCalls, 0);
});

test("failed or unverified confirmation never falls back to a previously signed-in account", async () => {
  for (const handleCallback of [
    async () => { throw new Error("Confirmation token expired"); },
    async (): Promise<CallbackResult> => ({ type: "confirmation", user: { ...verified, confirmedAt: undefined } }),
  ]) {
    let oldSessionCalls = 0;
    const initialize = createIdentityInitializer({ checkSettings: async () => {}, handleCallback,
      refreshSession: async () => {}, getUser: async () => { oldSessionCalls++; return verified; } });
    await assert.rejects(initialize());
    assert.equal(oldSessionCalls, 0);
  }
});

test("normal login still refreshes its session and invitation acceptance remains separate", async () => {
  let refreshCalls = 0;
  const initialize = createIdentityInitializer({ checkSettings: async () => {}, handleCallback: async () => null,
    refreshSession: async () => { refreshCalls++; }, getUser: async () => verified });
  assert.deepEqual(await initialize(), { callback: null, user: verified });
  assert.equal(refreshCalls, 1);
  const invite: CallbackResult = { type: "invite", user: null, token: "test-invite" };
  const initializeInvite = createIdentityInitializer({ checkSettings: async () => {}, handleCallback: async () => invite,
    refreshSession: async () => { throw new Error("must not refresh an invitation"); }, getUser: async () => null });
  assert.equal((await initializeInvite()).callback, invite);
});

test("Identity errors use German instructions and do not expose provider messages or tokens", () => {
  assert.match(identityErrorMessage(new Error("Confirmation token expired"), "confirmation"), /ungültig, abgelaufen oder wurde bereits verwendet/);
  assert.match(identityErrorMessage(Object.assign(new Error("Too many requests"), { status: 429 }), "confirmation"), /zu viele Versuche/);
  assert.match(identityErrorMessage(new TypeError("Failed to fetch"), "confirmation"), /Verbindung/);
  assert.match(identityErrorMessage(Object.assign(new Error("Invalid login credentials"), { status: 400 }), "login"), /E-Mail-Adresse oder Passwort/);
  assert.match(identityErrorMessage(new Error("Email not confirmed"), "login"), /bestätigen Sie zuerst/);
  assert.match(identityErrorMessage(new Error("already registered"), "signup"), /besteht bereits ein Konto/);
  assert.match(identityErrorMessage(new Error("Password must be at least 8 characters"), "signup"), /mindestens acht Zeichen/);
  const raw = "Provider failure: secret-test-token";
  for (const context of ["confirmation", "invite", "recovery", "signup", "login", "error"] as const) {
    const text = identityErrorMessage(new Error(raw), context);
    assert.doesNotMatch(text, /Provider|secret-test-token|Confirm your|Sign up/);
    assert.match(text, /Sie|E-Mail|Passwort|Konto|Anmeldung/);
  }
});

test("the success screen resolves the sponsor in a new tab and exposes failures for retry", async () => {
  const response = (access: Record<string, unknown>): typeof fetch => async (url, init) => {
    assert.equal(url, "/api/sponsor-portal/claim");
    assert.equal(init?.method, "POST");
    return Response.json(access);
  };
  assert.equal(await confirmedAccessDestination(false, response({ claimed: 1, hasAccess: true })), "sponsor");
  assert.equal(await confirmedAccessDestination(false, response({ claimed: 0, hasAccess: true, hasWorkspace: false })), "sponsor");
  assert.equal(await confirmedAccessDestination(false, response({ claimed: 0, hasAccess: true, hasWorkspace: true })), "workspace");
  assert.equal(await confirmedAccessDestination(true, response({ claimed: 0, hasAccess: true, hasWorkspace: true })), "sponsor");
  assert.equal(await confirmedAccessDestination(false, response({ hasAccess: false, hasWorkspace: true })), "workspace");
  await assert.rejects(confirmedAccessDestination(false, async () => Response.json({ error: "unavailable" }, { status: 503 })));
});

test("the German confirmation email preserves the Identity token, uses a matching fallback link and an email-compatible logo", async () => {
  const template = await readFile(new URL("../public/emails/confirmation.html", import.meta.url), "utf8");
  const target = "{{ .SiteURL }}/login/#confirmation_token={{ .Token }}";
  assert.equal(template.split(target).length - 1, 2);
  assert.match(template, /E-Mail-Adresse bestätigen/);
  assert.match(template, /lang="de"/);
  assert.doesNotMatch(template, /Confirm your|Confirm mail|Click here|<script|data:image|<svg/i);
  assert.match(template, /src="\{\{ \.SiteURL \}\}\/brand\/mittragen-icon-email\.png"/);
  const logo = await readFile(new URL("../public/brand/mittragen-icon-email.png", import.meta.url));
  assert.deepEqual([...logo.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
