import { AuthError, getIdentityConfig, type User } from "@netlify/identity";
import { findIdentityUserByEmail } from "./identity-user-lookup.ts";

export type InvitationDelivery = "sent" | "existing_user";

export class IdentityInvitationError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "IdentityInvitationError";
    this.status = status;
  }
}

type IdentityConfig = { url: string; token?: string };
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function postIdentityInvitation(config: IdentityConfig, email: string, fetcher: Fetcher = fetch): Promise<InvitationDelivery> {
  if (!config.token) throw new IdentityInvitationError("identity_operator_token_missing");
  const endpoint = `${config.url.replace(/\/$/, "")}/invite`;
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
    signal: AbortSignal.timeout(10000),
  });

  if (response.ok) return "sent";
  const body = await response.json().catch(() => ({})) as { msg?: unknown; message?: unknown; error?: unknown };
  const message = [body.msg, body.message, body.error].find((value): value is string => typeof value === "string") ?? `identity_invite_${response.status}`;
  if (response.status === 422 && /(already|registered|exists)/i.test(message)) return "existing_user";
  throw new IdentityInvitationError(message, response.status);
}

export async function postIdentityRecovery(config: IdentityConfig, email: string, fetcher: Fetcher = fetch): Promise<void> {
  const response = await fetcher(`${config.url.replace(/\/$/, "")}/recover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new IdentityInvitationError("identity_recovery_failed", response.status);
}

// Existing, unconfirmed invitation accounts cannot complete another signup.
// Send a recovery link for those accounts; verified accounts keep their login.
export async function deliverIdentityInvitation(email: string, dependencies: {
  invite: (email: string) => Promise<InvitationDelivery>;
  findUser: (email: string) => Promise<User | null>;
  recover: (email: string) => Promise<void>;
}): Promise<InvitationDelivery> {
  const delivery = await dependencies.invite(email);
  if (delivery === "sent") return delivery;
  const existing = await dependencies.findUser(email);
  if (!existing || existing.email?.trim().toLowerCase() !== email.trim().toLowerCase()) {
    throw new IdentityInvitationError("identity_user_lookup_failed");
  }
  if (existing.confirmedAt) return "existing_user";
  await dependencies.recover(email);
  return "sent";
}

export async function sendIdentityInvitation(email: string): Promise<InvitationDelivery> {
  const config = getIdentityConfig();
  if (!config) throw new AuthError("Identity is not configured");
  return deliverIdentityInvitation(email, {
    invite: (recipient) => postIdentityInvitation(config, recipient),
    findUser: findIdentityUserByEmail,
    recover: (recipient) => postIdentityRecovery(config, recipient),
  });
}
