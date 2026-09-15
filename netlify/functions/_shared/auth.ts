import { getUser, refreshSession, type User } from "@netlify/identity";
export { hasPermission, permissionsFor, type MembershipRole, type Permission } from "./permissions.ts";

export async function requireUser(request?: Request): Promise<User | Response> {
  try {
    await refreshSession();
  } catch (error) {
    console.error("identity_session_refresh_failed", error);
  }
  const user = await getUser();
  if (!user) return json({ error: "authentication_required" }, 401);
  const expected = request?.headers.get("X-Sponsor-Account") ?? (request ? new URL(request.url).searchParams.get("account") : null);
  if (expected && expected !== user.id) return json({ error: "sponsor_account_changed" }, 409);
  return user;
}

export const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});

export const isResponse = (value: User | Response): value is Response => value instanceof Response;
