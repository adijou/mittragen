import { AuthError, getIdentityConfig } from "@netlify/identity";

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
  });

  if (response.ok) return "sent";
  const body = await response.json().catch(() => ({})) as { msg?: unknown; message?: unknown; error?: unknown };
  const message = [body.msg, body.message, body.error].find((value): value is string => typeof value === "string") ?? `identity_invite_${response.status}`;
  if (response.status === 422 && /(already|registered|exists)/i.test(message)) return "existing_user";
  throw new IdentityInvitationError(message, response.status);
}

export async function sendIdentityInvitation(email: string): Promise<InvitationDelivery> {
  const config = getIdentityConfig();
  if (!config) throw new AuthError("Identity is not configured");
  return postIdentityInvitation(config, email);
}
