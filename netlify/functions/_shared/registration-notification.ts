import { createHash } from "node:crypto";
import type { User, UserSignupEvent } from "@netlify/functions";

type MailPayload = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  reply_to?: string;
};

export type NotificationRecord =
  | { status: "pending"; startedAt: number; payload: MailPayload }
  | { status: "sent"; sentAt: string; messageId: string };

export type NotificationStore = {
  get(key: string, options: { type: "json" }): Promise<NotificationRecord | null>;
  setJSON(key: string, value: NotificationRecord, options?: { onlyIfNew: true }): Promise<unknown>;
};

export type NotificationSettings = {
  context: string;
  siteId: string;
  recipient?: string;
  apiKey?: string;
  from?: string;
  replyTo?: string;
};

type Dependencies = {
  settings: () => NotificationSettings;
  store: () => NotificationStore;
  fetcher?: typeof fetch;
  now?: () => number;
};

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
// Resend retains idempotency keys for 24 hours. Never blindly replay an
// unresolved request after that window: delivery may already have succeeded.
const SAFE_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character] ?? character);
}

function displayName(user: User) {
  const value = [user.name, user.userMetadata?.full_name, user.userMetadata?.name]
    .find((candidate) => typeof candidate === "string" && candidate.trim());
  return typeof value === "string" ? value.trim().slice(0, 200) : "Nicht angegeben";
}

function buildPayload(user: User, settings: NotificationSettings, now: number): MailPayload {
  const name = displayName(user);
  const email = user.email!.trim();
  const confirmed = user.confirmedAt ? Date.parse(user.confirmedAt) : NaN;
  const activatedAt = new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(Number.isFinite(confirmed) ? confirmed : now));
  const details = `Name: ${name}\nE-Mail-Adresse: ${email}\nAktiviert am: ${activatedAt} (Schweizer Zeit)`;
  return {
    from: settings.from!,
    to: [settings.recipient!],
    subject: "Neue erfolgreiche Registrierung auf mittragen.ch",
    text: `Ein neues Konto auf mittragen.ch wurde erfolgreich aktiviert.\n\n${details}\n\nDiese Benachrichtigung begleitet die Pilotphase. Sie wird einmal pro neu aktiviertem Konto versendet.`,
    html: `<!doctype html><html lang="de"><body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0b2142;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;"><tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:white;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:26px 32px;background:#0b2142;color:white;font-size:24px;font-weight:800;">mittragen<span style="color:#7fadff;">.ch</span><span style="color:#f2b632;"> ·</span></td></tr>
          <tr><td style="padding:32px;"><h1 style="font-size:25px;margin:0 0 20px;">Neue Registrierung</h1>
            <p style="line-height:1.6;">Ein neues Konto auf mittragen.ch wurde erfolgreich aktiviert.</p>
            <p style="line-height:1.8;"><strong>Name:</strong> ${escapeHtml(name)}<br><strong>E-Mail-Adresse:</strong> ${escapeHtml(email)}<br><strong>Aktiviert am:</strong> ${escapeHtml(activatedAt)} (Schweizer Zeit)</p>
            <p style="font-size:13px;line-height:1.6;color:#53657c;">Diese Benachrichtigung begleitet die Pilotphase. Sie wird einmal pro neu aktiviertem Konto versendet.</p>
          </td></tr>
        </table>
      </td></tr></table></body></html>`,
    ...(settings.replyTo ? { reply_to: settings.replyTo } : {}),
  };
}

/** Only attach to Netlify's signed userSignup event, never to a public route. */
export function createRegistrationNotificationHandler(dependencies: Dependencies) {
  return {
    async userSignup(event: UserSignupEvent): Promise<undefined> {
      const settings = dependencies.settings();
      // An unset recipient disables pilot notifications. Preview/dev events
      // must neither send mail nor write to the site's persistent store.
      if (settings.context !== "production" || !settings.recipient?.trim()) return;
      const recipient = settings.recipient.trim();
      if (!EMAIL.test(recipient) || !settings.siteId || !settings.apiKey || !settings.from) {
        throw new Error("registration_notification_not_configured");
      }
      const user = event.user;
      if (!user?.id || !user.email || !EMAIL.test(user.email.trim())) {
        throw new Error("registration_notification_invalid_user");
      }
      // userSignup is emitted after successful confirmation. confirmedAt may
      // be absent in the event (e.g. provider signup); the event is authoritative.
      const now = dependencies.now ?? Date.now;
      const key = createHash("sha256").update(`${settings.siteId}:${user.id}`).digest("hex");
      const store = dependencies.store();
      let record = await store.get(key, { type: "json" });
      if (!record) {
        await store.setJSON(key, {
          status: "pending", startedAt: now(),
          payload: buildPayload(user, { ...settings, recipient }, now()),
        }, { onlyIfNew: true });
        // Read the winner of the atomic insert, so concurrent events and
        // retries always send exactly the same payload and idempotency key.
        record = await store.get(key, { type: "json" });
      }
      if (!record) throw new Error("registration_notification_record_missing");
      if (record.status === "sent") return;
      if (now() - record.startedAt >= SAFE_RETRY_WINDOW_MS) {
        throw new Error("registration_notification_delivery_requires_review");
      }
      const response = await (dependencies.fetcher ?? fetch)("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `registration/${key}`,
        },
        body: JSON.stringify(record.payload),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`registration_notification_resend_${response.status}`);
      const result = await response.json().catch(() => ({})) as { id?: unknown };
      if (typeof result.id !== "string" || !result.id) {
        throw new Error("registration_notification_invalid_response");
      }
      // Keep only the delivery receipt once Resend has accepted the email.
      await store.setJSON(key, { status: "sent", sentAt: new Date(now()).toISOString(), messageId: result.id });
    },
  };
}
