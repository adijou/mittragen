import type { MembershipRole } from "./permissions.ts";

export const assignableRoles = ["owner", "sponsoring_admin", "finance", "fulfillment", "viewer"] as const satisfies readonly MembershipRole[];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InvitationInput = {
  email: string;
  role: MembershipRole;
};

export function parseInvitationInput(input: unknown): { ok: true; value: InvitationInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "invalid_invitation" };
  const candidate = input as { email?: unknown; role?: unknown };
  const email = typeof candidate.email === "string" ? candidate.email.trim().toLowerCase() : "";
  const role = typeof candidate.role === "string" ? candidate.role : "";

  if (!emailPattern.test(email) || email.length > 254) return { ok: false, error: "invalid_email" };
  if (!assignableRoles.includes(role as MembershipRole)) return { ok: false, error: "invalid_role" };
  return { ok: true, value: { email, role: role as MembershipRole } };
}

export function parseMembershipUpdate(input: unknown): { ok: true; value: { role: MembershipRole } } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "invalid_member_update" };
  const role = (input as { role?: unknown }).role;
  if (typeof role !== "string" || !assignableRoles.includes(role as MembershipRole)) return { ok: false, error: "invalid_role" };
  return { ok: true, value: { role: role as MembershipRole } };
}
