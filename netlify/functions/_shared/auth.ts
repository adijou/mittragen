import { getUser, refreshSession, type User } from "@netlify/identity";
export { hasPermission, permissionsFor, type MembershipRole, type Permission } from "./permissions.ts";

export async function requireUser(): Promise<User | Response> {
  try {
    await refreshSession();
  } catch (error) {
    console.error("identity_session_refresh_failed", error);
  }
  const user = await getUser();
  if (!user) return json({ error: "authentication_required" }, 401);
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
