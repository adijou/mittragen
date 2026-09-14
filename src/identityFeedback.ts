import type { CallbackResult, User } from "@netlify/identity";
import { shouldOpenSponsorSpace } from "./sponsorAccess.ts";

export type IdentityCallbackKind = "confirmation" | "invite" | "recovery" | "oauth" | "email_change" | "error";

export function identityCallbackKind(hash: string): IdentityCallbackKind | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (params.has("error") || params.has("error_description")) return "error";
  for (const [key, kind] of [
    ["access_token", "oauth"], ["confirmation_token", "confirmation"], ["recovery_token", "recovery"],
    ["invite_token", "invite"], ["email_change_token", "email_change"],
  ] as const) if (params.has(key)) return kind;
  return null;
}

export function confirmedEmailCallback(result: CallbackResult | null): User | null {
  // An existing signed-in user or a token in the URL is not proof of confirmation.
  return result?.type === "confirmation" && result.user?.confirmedAt && result.user.email ? result.user : null;
}

export function invitedConfirmationCallback(reason: unknown, hash: string): CallbackResult | null {
  const message = reason instanceof Error ? reason.message : "";
  const status = reason && typeof reason === "object" && "status" in reason ? reason.status : undefined;
  if (status !== 422 || !/invited users must specify a password/i.test(message)) return null;
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("confirmation_token");
  return token ? { type: "invite", user: null, token } : null;
}

export function confirmationDeliveryMessage(
  user: Pick<User, "confirmationSentAt" | "invitedAt">,
  now = Date.now(),
) {
  const sentAt = user.confirmationSentAt ? Date.parse(user.confirmationSentAt) : Number.NaN;
  const sentWithThisRequest = Number.isFinite(sentAt) && Math.abs(now - sentAt) < 60_000;
  if (!sentWithThisRequest) {
    if (Number.isFinite(sentAt) && now >= sentAt && now - sentAt < 15 * 60_000) {
      return "Es wurde noch keine neue Bestätigungsmail verschickt, weil für diese Adresse kürzlich bereits eine Mail erstellt wurde. Bitte verwenden Sie den zuletzt erhaltenen Link oder versuchen Sie es 15 Minuten nach der letzten Anforderung erneut.";
    }
    return "Ein neuer Mailversand konnte nicht bestätigt werden. Bitte versuchen Sie es erneut. Falls bereits eine Bestätigungsmail vorhanden ist, verwenden Sie den Link aus dieser Mail.";
  }
  if (user.invitedAt) {
    return "Bestätigungsmail verschickt. Öffnen Sie den Link und legen Sie dort Ihr Passwort fest, um den Zugang zu aktivieren.";
  }
  return "Konto erstellt. Bitte öffnen Sie den Bestätigungslink in Ihrer E-Mail.";
}

export function identityErrorMessage(reason: unknown, context: IdentityCallbackKind | "login" | "signup" | "initialization" = "login") {
  const message = reason instanceof Error ? reason.message.toLowerCase() : "";
  const status = reason && typeof reason === "object" && "status" in reason ? reason.status : undefined;
  if (status === 429 || /rate limit|too many requests/.test(message)) {
    return "Es gab zu viele Versuche. Bitte warten Sie einen Moment und versuchen Sie es erneut.";
  }
  if (/fetch|network|timeout|timed out|abort/.test(message) || (typeof status === "number" && status >= 500)) {
    return "Die Verbindung ist momentan nicht verfügbar. Bitte versuchen Sie es erneut.";
  }
  if (context === "confirmation") {
    return "Die E-Mail-Adresse konnte nicht bestätigt werden. Der Link ist ungültig, abgelaufen oder wurde bereits verwendet. Falls Ihr Konto bereits bestätigt ist, können Sie sich unten anmelden.";
  }
  if (context === "invite") return "Die Einladung konnte nicht angenommen werden. Prüfen Sie den Link und Ihr Passwort oder bitten Sie die Organisation um eine neue Einladung.";
  if (context === "recovery") return "Das Passwort konnte nicht zurückgesetzt werden. Fordern Sie über «Passwort vergessen?» einen neuen Link an.";
  if (context === "email_change") return "Die neue E-Mail-Adresse konnte nicht bestätigt werden. Melden Sie sich an und öffnen Sie den aktuellen Bestätigungslink erneut.";
  if (context === "error" || context === "oauth") return "Die Anmeldung über diesen Link ist fehlgeschlagen. Bitte melden Sie sich unten erneut an.";
  if (/not confirmed|not verified|confirm.*email/.test(message)) return "Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse über den Link in Ihrer Bestätigungsmail.";
  if (/already.*(registered|exists)|already been registered/.test(message)) return "Für diese E-Mail-Adresse besteht bereits ein Konto. Bitte melden Sie sich an oder wählen Sie «Passwort vergessen?».";
  if (/password.*(short|least|weak)|weak password/.test(message)) return "Bitte wählen Sie ein Passwort mit mindestens acht Zeichen.";
  if (/invalid.*email|email.*invalid/.test(message)) return "Bitte prüfen Sie die eingegebene E-Mail-Adresse.";
  if (context === "login" && (status === 400 || status === 401 || /invalid.*credentials|invalid.*password/.test(message))) {
    return "E-Mail-Adresse oder Passwort stimmen nicht. Bitte prüfen Sie Ihre Eingaben.";
  }
  if (context === "signup" && status === 403) return "Die Kontoerstellung ist momentan nicht möglich. Bitte wenden Sie sich an die Organisation.";
  return context === "signup" ? "Das Konto konnte nicht erstellt werden. Bitte versuchen Sie es erneut."
    : "Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.";
}

type IdentityInitialization = { callback: CallbackResult | null; user: User | null };

// React StrictMode mounts effects twice. The same one-time token must be redeemed once.
export function createIdentityInitializer(dependencies: {
  checkSettings: () => Promise<void>;
  handleCallback: () => Promise<CallbackResult | null>;
  refreshSession: () => Promise<unknown>;
  getUser: () => Promise<User | null>;
}) {
  let pending: Promise<IdentityInitialization> | undefined;
  return () => pending ??= (async () => {
    await dependencies.checkSettings();
    const callback = await dependencies.handleCallback();
    if (callback?.type === "confirmation" && !confirmedEmailCallback(callback)) throw new Error("email_confirmation_failed");
    if (!callback) await dependencies.refreshSession();
    return { callback, user: callback?.user ?? await dependencies.getUser() };
  })();
}

export async function confirmedAccessDestination(preferSponsor: boolean, fetcher: typeof fetch = fetch): Promise<"sponsor" | "workspace"> {
  const response = await fetcher("/api/sponsor-portal/claim", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  if (!response.ok) throw new Error("access_check_failed");
  const access = await response.json() as { claimed?: number; hasAccess?: boolean; hasWorkspace?: boolean };
  return preferSponsor || shouldOpenSponsorSpace(access) ? "sponsor" : "workspace";
}
