import assert from "node:assert/strict";
import test from "node:test";
import type { UserSignupEvent } from "@netlify/functions";
import {
  createRegistrationNotificationHandler,
  type NotificationRecord, type NotificationSettings, type NotificationStore,
} from "../netlify/functions/_shared/registration-notification.ts";
import deployedHandler, { config } from "../netlify/functions/registration-notification.ts";

const activationTime = Date.parse("2026-09-15T13:00:00Z");
const settings: NotificationSettings = {
  context: "production", siteId: "test-site", recipient: "pilot-owner@example.ch",
  apiKey: "test-secret", from: "mittragen.ch <noreply@example.ch>", replyTo: "support@example.ch",
};
function event(overrides: Partial<UserSignupEvent["user"]> = {}): UserSignupEvent {
  return {
    user: {
      id: "new-user", email: "sponsor@example.ch", confirmedAt: new Date(activationTime).toISOString(),
      userMetadata: { full_name: "Max & <Muster>", password: "never-forward-this", recipient: "attacker@example.ch" },
      ...overrides,
    },
    deny: () => { throw new Error("Account activation must never be denied"); },
  };
}
function memoryStore() {
  const data = new Map<string, NotificationRecord>();
  let failReceipt = false;
  const store: NotificationStore = {
    async get(key) { return structuredClone(data.get(key) ?? null); },
    async setJSON(key, value, options) {
      if (value.status === "sent" && failReceipt) throw new Error("storage_unavailable");
      if (options?.onlyIfNew && data.has(key)) return { modified: false };
      data.set(key, structuredClone(value));
      return { modified: true };
    },
  };
  return { data, store, failNextReceipt: (value: boolean) => { failReceipt = value; } };
}
function setup(options: { settings?: Partial<NotificationSettings>; fetcher?: typeof fetch } = {}) {
  const memory = memoryStore();
  const requests: RequestInit[] = [];
  let clock = activationTime;
  const handler = createRegistrationNotificationHandler({
    settings: () => ({ ...settings, ...options.settings }), store: () => memory.store,
    now: () => clock,
    fetcher: options.fetcher ?? (async (url, init) => {
      assert.equal(url, "https://api.resend.com/emails");
      requests.push(init!);
      return Response.json({ id: "email-123" });
    }),
  });
  return { ...memory, handler, requests, advance: (ms: number) => { clock += ms; } };
}

test("successful signup sends a German branded notification only to the configured recipient", async () => {
  const testCase = setup();
  const signup = event();
  const originalUser = structuredClone(signup.user);
  assert.equal(await testCase.handler.userSignup(signup), undefined);
  assert.deepEqual(signup.user, originalUser);
  const request = testCase.requests[0];
  const mail = JSON.parse(String(request.body));
  assert.deepEqual(mail.to, [settings.recipient]);
  assert.equal(mail.from, settings.from);
  assert.equal(mail.reply_to, settings.replyTo);
  assert.match(mail.subject, /Neue erfolgreiche Registrierung/);
  assert.match(mail.html, /Max &amp; &lt;Muster&gt;/);
  assert.match(mail.text, /sponsor@example.ch/);
  assert.match(mail.text, /15\.09\.2026, 15:00/);
  assert.doesNotMatch(String(request.body), /never-forward-this|attacker@example.ch|test-secret/);
  assert.match(new Headers(request.headers).get("Idempotency-Key")!, /^registration\/[a-f0-9]{64}$/);
  assert.equal(new Headers(request.headers).get("Authorization"), "Bearer test-secret");
  assert.ok(request.signal);
  const receipt = [...testCase.data.values()][0];
  assert.equal(receipt.status, "sent");
  assert.doesNotMatch(JSON.stringify(receipt), /sponsor@example.ch|Muster/);
});

test("duplicate signup events stay suppressed after the provider's 24-hour retention", async () => {
  const testCase = setup();
  await testCase.handler.userSignup(event());
  testCase.advance(7 * 24 * 60 * 60 * 1000);
  await testCase.handler.userSignup(event({ email: "changed@example.ch" }));
  assert.equal(testCase.requests.length, 1);
  await testCase.handler.userSignup(event({ id: "another-user" }));
  assert.equal(testCase.requests.length, 2);
});

test("concurrent events use one immutable payload and provider idempotency key", async () => {
  const testCase = setup();
  await Promise.all([
    testCase.handler.userSignup(event()),
    testCase.handler.userSignup(event({ name: "Changed while retrying" })),
  ]);
  assert.ok(testCase.requests.length >= 1);
  assert.equal(new Set(testCase.requests.map((r) => r.body)).size, 1);
  assert.equal(new Set(testCase.requests.map((r) => new Headers(r.headers).get("Idempotency-Key"))).size, 1);
  assert.equal(testCase.data.size, 1);
});

test("provider errors stay retryable and do not expose provider response details", async () => {
  let fail = true;
  const requests: RequestInit[] = [];
  const testCase = setup({ fetcher: async (_url, init) => {
    requests.push(init!);
    return fail ? Response.json({ message: "sensitive provider response" }, { status: 503 }) : Response.json({ id: "retry-ok" });
  } });
  await assert.rejects(testCase.handler.userSignup(event()), { message: "registration_notification_resend_503" });
  assert.equal([...testCase.data.values()][0].status, "pending");
  fail = false;
  testCase.advance(60_000);
  await testCase.handler.userSignup(event({ confirmedAt: undefined, name: "Changed" }));
  assert.equal(requests[0].body, requests[1].body);
  assert.equal([...testCase.data.values()][0].status, "sent");
});

test("failed receipt storage can retry without generating a second provider email", async () => {
  const testCase = setup();
  testCase.failNextReceipt(true);
  await assert.rejects(testCase.handler.userSignup(event()), /storage_unavailable/);
  testCase.failNextReceipt(false);
  await testCase.handler.userSignup(event());
  assert.equal(testCase.requests[0].body, testCase.requests[1].body);
  assert.equal(new Headers(testCase.requests[0].headers).get("Idempotency-Key"), new Headers(testCase.requests[1].headers).get("Idempotency-Key"));
});

test("ambiguous delivery is not resent beyond the provider idempotency window", async () => {
  const testCase = setup();
  testCase.failNextReceipt(true);
  await assert.rejects(testCase.handler.userSignup(event()), /storage_unavailable/);
  testCase.failNextReceipt(false);
  testCase.advance(24 * 60 * 60 * 1000);
  await assert.rejects(testCase.handler.userSignup(event()), /delivery_requires_review/);
  assert.equal(testCase.requests.length, 1);
});

test("preview, development and disabled notifications never access storage or send mail", async () => {
  for (const override of [{ context: "deploy-preview" }, { context: "dev" }, { recipient: undefined }]) {
    const handler = createRegistrationNotificationHandler({
      settings: () => ({ ...settings, ...override }),
      store: () => { throw new Error("Must not access production storage"); },
      fetcher: async () => { throw new Error("Must not send mail"); },
    });
    await handler.userSignup(event());
  }
});

test("missing configuration and malformed users cannot send notifications", async () => {
  for (const override of [{ apiKey: undefined }, { from: undefined }, { recipient: "invalid-address" }]) {
    const testCase = setup({ settings: override });
    await assert.rejects(testCase.handler.userSignup(event()), /not_configured/);
    assert.equal(testCase.requests.length, 0);
  }
  for (const user of [{ email: undefined }, { email: "bad\r\naddress" }, { id: "" }]) {
    const testCase = setup();
    await assert.rejects(testCase.handler.userSignup(event(user)), /invalid_user/);
    assert.equal(testCase.requests.length, 0);
  }
});

test("a successful signup event without optional confirmation date still notifies", async () => {
  const testCase = setup();
  await testCase.handler.userSignup(event({ confirmedAt: undefined, invitedAt: "2026-09-14T10:00:00Z" }));
  assert.equal(testCase.requests.length, 1);
});

test("malformed successful provider response is not recorded as sent", async () => {
  const testCase = setup({ fetcher: async () => Response.json({ unexpected: true }) });
  await assert.rejects(testCase.handler.userSignup(event()), /invalid_response/);
  assert.equal([...testCase.data.values()][0].status, "pending");
});

test("deployed function only subscribes to signup and runs in background", () => {
  assert.deepEqual(Object.keys(deployedHandler), ["userSignup"]);
  assert.equal(config.background, true);
});
