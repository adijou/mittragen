import type { User } from "@netlify/identity";

type Verification = { user: User; error?: never; status?: never }
  | { user?: never; error: "authentication_required" | "verified_email_required" | "identity_verification_unavailable"; status: number };

// The SDK can return validated JWT claims without confirmedAt on the server.
// Missing profile data is not evidence that the account is unconfirmed. Read
// /user with the caller's own token, never with the site's operator token.
export async function verifySponsorIdentity(
  user: User,
  accessToken: string | undefined,
  identityUrl: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<Verification> {
  if (!user.id || !user.email) return { error: "verified_email_required", status: 422 };
  if (user.confirmedAt) return { user };
  if (!accessToken) return { error: "authentication_required", status: 401 };
  if (!identityUrl) return { error: "identity_verification_unavailable", status: 503 };
  try {
    const response = await fetcher(`${identityUrl.replace(/\/$/, "")}/user`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(4500), redirect: "error",
    });
    if (response.status === 401 || response.status === 403) return { error: "authentication_required", status: 401 };
    if (!response.ok) return { error: "identity_verification_unavailable", status: 503 };
    const profile = await response.json() as { id?: unknown; email?: unknown; confirmed_at?: unknown } | null;
    if (!profile || typeof profile !== "object") return { error: "identity_verification_unavailable", status: 503 };
    if (profile.id !== user.id || typeof profile.email !== "string"
      || profile.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      return { error: "authentication_required", status: 401 };
    }
    if (typeof profile.confirmed_at !== "string" || !Number.isFinite(Date.parse(profile.confirmed_at))) {
      return { error: "verified_email_required", status: 422 };
    }
    return { user: { ...user, email: profile.email, confirmedAt: profile.confirmed_at } };
  } catch {
    return { error: "identity_verification_unavailable", status: 503 };
  }
}
