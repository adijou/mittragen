import type { Config, Context } from "@netlify/functions";
import { AuthError, verifyRequestOrigin, type User } from "@netlify/identity";
import { hasPermission, isResponse, json, requireUser, type MembershipRole } from "./_shared/auth.ts";
import { isUuid, withSession, type DatabaseClient } from "./_shared/database.ts";
import { IdentityInvitationError, sendIdentityInvitation, type InvitationDelivery } from "./_shared/identity-invitations.ts";
import { ResendDeliveryError, sendExistingUserAccessEmail } from "./_shared/resend-access-email.ts";
import { parseInvitationInput, parseMembershipUpdate } from "./_shared/team-input.ts";

type MembershipRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: MembershipRole;
  created_at: string;
};

type InvitationRow = {
  id: string;
  email: string;
  role: MembershipRole;
  delivery_status: "pending" | "sent" | "existing_user" | "failed";
  expires_at: string;
  identity_invited_at: string | null;
  created_at: string;
};

type PreparedInvitation = (InvitationRow & { tenant_name: string }) | { state: "already_member" };

const routePatterns = {
  tenant: /^\/api\/team\/([0-9a-f-]+)$/i,
  invitations: /^\/api\/team\/([0-9a-f-]+)\/invitations$/i,
  member: /^\/api\/team\/([0-9a-f-]+)\/members\/([0-9a-f-]+)$/i,
};

function verifyMutation(request: Request): Response | null {
  try {
    verifyRequestOrigin(request);
    return null;
  } catch (error) {
    return json({ error: "invalid_request_origin" }, (error as AuthError).status ?? 403);
  }
}

async function managerRole(client: DatabaseClient, tenantId: string, userId: string) {
  const membership = await client.query<{ role: MembershipRole }>(`
    SELECT role
    FROM tenant_memberships
    WHERE tenant_id = $1 AND identity_user_id = $2
    LIMIT 1
  `, [tenantId, userId]);
  return membership.rows[0]?.role;
}

async function claimInvitations(user: User) {
  const email = user.email?.trim().toLowerCase();
  if (!email) return { error: "verified_email_required" as const };

  const claimed = await withSession(user.id, null, async (client) => {
    const invitations = await client.query<InvitationRow & { tenant_id: string }>(`
      SELECT id, tenant_id, email, role, delivery_status, expires_at::text, identity_invited_at::text, created_at::text
      FROM tenant_invitations
      WHERE lower(email) = lower($1)
        AND accepted_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > now()
      ORDER BY created_at
    `, [email]);

    const tenantIds: string[] = [];
    for (const invitation of invitations.rows) {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [invitation.tenant_id]);
      await client.query(`
        INSERT INTO tenant_memberships (tenant_id, identity_user_id, email, display_name, role)
        VALUES ($1, $2, $3, $4, $5::membership_role)
        ON CONFLICT (tenant_id, identity_user_id)
        DO UPDATE SET email = EXCLUDED.email, display_name = COALESCE(tenant_memberships.display_name, EXCLUDED.display_name)
      `, [invitation.tenant_id, user.id, email, user.name ?? null, invitation.role]);

      await client.query(`
        UPDATE tenant_invitations
        SET accepted_at = now()
        WHERE id = $1 AND tenant_id = $2 AND accepted_at IS NULL
      `, [invitation.id, invitation.tenant_id]);

      await client.query(`
        INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
        VALUES ($1, $2, 'team.invitation.accepted', 'membership', $3::text, jsonb_build_object('email', $4::text, 'role', $5::text))
      `, [invitation.tenant_id, user.id, user.id, email, invitation.role]);
      tenantIds.push(invitation.tenant_id);
    }
    return tenantIds;
  }, email);

  return { claimed: claimed.length, tenantIds: claimed };
}

async function listTeam(tenantId: string, userId: string) {
  return withSession(userId, tenantId, async (client) => {
    const role = await managerRole(client, tenantId, userId);
    if (!role || !hasPermission(role, "members:manage")) return null;

    const members = await client.query<MembershipRow>(`
      SELECT id, email, display_name, role, created_at::text
      FROM tenant_memberships
      WHERE tenant_id = $1
      ORDER BY CASE role
        WHEN 'owner' THEN 1
        WHEN 'sponsoring_admin' THEN 2
        WHEN 'finance' THEN 3
        WHEN 'fulfillment' THEN 4
        ELSE 5
      END, lower(COALESCE(display_name, email, ''))
    `, [tenantId]);

    const invitations = await client.query<InvitationRow>(`
      SELECT id, email, role, delivery_status, expires_at::text, identity_invited_at::text, created_at::text
      FROM tenant_invitations
      WHERE tenant_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC
    `, [tenantId]);

    return { members: members.rows, invitations: invitations.rows };
  });
}

async function prepareInvitation(tenantId: string, userId: string, email: string, role: MembershipRole): Promise<PreparedInvitation | null> {
  return withSession(userId, tenantId, async (client) => {
    const currentRole = await managerRole(client, tenantId, userId);
    if (!currentRole || !hasPermission(currentRole, "members:manage")) return null;

    const existingMember = await client.query<{ id: string }>(`
      SELECT id FROM tenant_memberships
      WHERE tenant_id = $1 AND lower(email) = lower($2)
      LIMIT 1
    `, [tenantId, email]);
    if (existingMember.rows[0]) return { state: "already_member" };

    const tenant = await client.query<{ name: string }>(`
      SELECT name FROM tenants WHERE id = $1 LIMIT 1
    `, [tenantId]);
    if (!tenant.rows[0]) return null;

    const existing = await client.query<{ id: string }>(`
      SELECT id FROM tenant_invitations
      WHERE tenant_id = $1 AND lower(email) = lower($2) AND accepted_at IS NULL AND revoked_at IS NULL
      LIMIT 1
    `, [tenantId, email]);

    const invitation = existing.rows[0]
      ? await client.query<InvitationRow>(`
          UPDATE tenant_invitations
          SET role = $3::membership_role,
              token_hash = $4,
              expires_at = now() + interval '7 days',
              delivery_status = 'pending',
              delivery_error = NULL,
              identity_invited_at = NULL
          WHERE id = $1 AND tenant_id = $2
          RETURNING id, email, role, delivery_status, expires_at::text, identity_invited_at::text, created_at::text
        `, [existing.rows[0].id, tenantId, role, crypto.randomUUID()])
      : await client.query<InvitationRow>(`
          INSERT INTO tenant_invitations (tenant_id, email, role, token_hash, expires_at, invited_by)
          VALUES ($1, $2, $3::membership_role, $4, now() + interval '7 days', $5)
          RETURNING id, email, role, delivery_status, expires_at::text, identity_invited_at::text, created_at::text
        `, [tenantId, email, role, crypto.randomUUID(), userId]);

    return { ...invitation.rows[0], tenant_name: tenant.rows[0].name };
  });
}

const invitationRoleLabels: Record<MembershipRole, string> = {
  owner: "Owner",
  sponsoring_admin: "Sponsoring-Admin",
  finance: "Finanzen",
  fulfillment: "Sponsoringleistungen",
  viewer: "Lesen",
};

function getResendConfig() {
  const apiKey = Netlify.env.get("RESEND_API_KEY")?.trim();
  if (!apiKey) throw new ResendDeliveryError("resend_not_configured");
  return {
    apiKey,
    from: Netlify.env.get("MAIL_FROM")?.trim() || "Mittragen <noreply@news.mittragen.ch>",
    replyTo: Netlify.env.get("MAIL_REPLY_TO")?.trim() || undefined,
  };
}

function getLoginUrl(request: Request) {
  const siteUrl = Netlify.env.get("URL")?.trim() || new URL(request.url).origin;
  return new URL("/login", siteUrl).toString();
}

async function recordDelivery(tenantId: string, userId: string, invitationId: string, email: string, role: MembershipRole, delivery: InvitationDelivery | "failed", deliveryError?: string) {
  return withSession(userId, tenantId, async (client) => {
    const currentRole = await managerRole(client, tenantId, userId);
    if (!currentRole || !hasPermission(currentRole, "members:manage")) return null;
    const updated = await client.query<InvitationRow>(`
      UPDATE tenant_invitations
      SET delivery_status = $3,
          delivery_error = $4,
          identity_invited_at = CASE WHEN $3 = 'sent' THEN now() ELSE identity_invited_at END
      WHERE id = $1 AND tenant_id = $2
      RETURNING id, email, role, delivery_status, expires_at::text, identity_invited_at::text, created_at::text
    `, [invitationId, tenantId, delivery, deliveryError ?? null]);

    await client.query(`
      INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
      VALUES ($1, $2, $3, 'invitation', $4::text, jsonb_build_object('email', $5::text, 'role', $6::text, 'delivery', $7::text))
    `, [tenantId, userId, delivery === "failed" ? "team.invitation.failed" : "team.invitation.sent", invitationId, email, role, delivery]);
    return updated.rows[0];
  });
}

async function updateMember(tenantId: string, membershipId: string, userId: string, role: MembershipRole) {
  return withSession(userId, tenantId, async (client) => {
    const currentRole = await managerRole(client, tenantId, userId);
    if (!currentRole || !hasPermission(currentRole, "members:manage")) return { state: "denied" as const };

    const targetResult = await client.query<MembershipRow>(`
      SELECT id, email, display_name, role, created_at::text
      FROM tenant_memberships
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1
    `, [membershipId, tenantId]);
    const target = targetResult.rows[0];
    if (!target) return { state: "not_found" as const };

    if (target.role === "owner" && role !== "owner") {
      const owners = await client.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM tenant_memberships
        WHERE tenant_id = $1 AND role = 'owner'
      `, [tenantId]);
      if (Number(owners.rows[0]?.count ?? 0) <= 1) return { state: "last_owner" as const };
    }

    const updated = await client.query<MembershipRow>(`
      UPDATE tenant_memberships
      SET role = $3::membership_role
      WHERE id = $1 AND tenant_id = $2
      RETURNING id, email, display_name, role, created_at::text
    `, [membershipId, tenantId, role]);

    await client.query(`
      INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
      VALUES ($1, $2, 'team.member.role_changed', 'membership', $3::text, jsonb_build_object('from', $4::text, 'to', $5::text))
    `, [tenantId, userId, membershipId, target.role, role]);
    return { state: "updated" as const, member: updated.rows[0] };
  });
}

export default async (request: Request, context: Context) => {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const pathname = new URL(request.url).pathname;

  if (pathname === "/api/team/claim") {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const invalidOrigin = verifyMutation(request);
    if (invalidOrigin) return invalidOrigin;
    try {
      const result = await claimInvitations(user);
      if ("error" in result) return json({ error: result.error }, 422);
      return json(result);
    } catch (error) {
      console.error("team_claim_failed", { requestId: context.requestId, userId: user.id, error });
      return json({ error: "team_claim_failed", requestId: context.requestId }, 500);
    }
  }

  const tenantMatch = pathname.match(routePatterns.tenant);
  if (tenantMatch && request.method === "GET") {
    const tenantId = tenantMatch[1];
    if (!isUuid(tenantId)) return json({ error: "invalid_tenant" }, 422);
    try {
      const team = await listTeam(tenantId, user.id);
      return team ? json({ team }) : json({ error: "permission_denied" }, 403);
    } catch (error) {
      console.error("team_load_failed", { requestId: context.requestId, tenantId, error });
      return json({ error: "team_load_failed", requestId: context.requestId }, 500);
    }
  }

  const invitationMatch = pathname.match(routePatterns.invitations);
  if (invitationMatch) {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const tenantId = invitationMatch[1];
    if (!isUuid(tenantId)) return json({ error: "invalid_tenant" }, 422);
    const invalidOrigin = verifyMutation(request);
    if (invalidOrigin) return invalidOrigin;
    const parsed = parseInvitationInput(await request.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, 422);

    try {
      const prepared = await prepareInvitation(tenantId, user.id, parsed.value.email, parsed.value.role);
      if (!prepared) return json({ error: "permission_denied" }, 403);
      if ("state" in prepared) return json({ error: "already_member" }, 409);

      try {
        const delivery = await sendIdentityInvitation(parsed.value.email);

        if (delivery === "existing_user") {
          try {
            await sendExistingUserAccessEmail({
              email: parsed.value.email,
              organizationName: prepared.tenant_name,
              roleLabel: invitationRoleLabels[parsed.value.role],
              loginUrl: getLoginUrl(request),
            }, getResendConfig());
          } catch (error) {
            const detail = error instanceof ResendDeliveryError ? `${error.status ?? error.message}` : "resend_error";
            await recordDelivery(tenantId, user.id, prepared.id, parsed.value.email, parsed.value.role, "failed", detail).catch(() => null);
            console.error("existing_user_notification_failed", { requestId: context.requestId, tenantId, invitationId: prepared.id, error });
            return json({ error: "existing_user_notification_failed", requestId: context.requestId }, 502);
          }
        }

        const invitation = await recordDelivery(tenantId, user.id, prepared.id, parsed.value.email, parsed.value.role, delivery);
        if (!invitation) return json({ error: "permission_denied" }, 403);
        return json({ invitation, delivery }, 201);
      } catch (error) {
        const detail = error instanceof IdentityInvitationError ? `${error.status ?? "unknown"}` : "identity_error";
        await recordDelivery(tenantId, user.id, prepared.id, parsed.value.email, parsed.value.role, "failed", detail).catch(() => null);
        console.error("identity_invite_failed", { requestId: context.requestId, tenantId, invitationId: prepared.id, error });
        return json({ error: "identity_invite_failed", requestId: context.requestId }, 502);
      }
    } catch (error) {
      console.error("team_invitation_failed", { requestId: context.requestId, tenantId, error });
      return json({ error: "team_invitation_failed", requestId: context.requestId }, 500);
    }
  }

  const memberMatch = pathname.match(routePatterns.member);
  if (memberMatch) {
    if (request.method !== "PATCH") return json({ error: "method_not_allowed" }, 405);
    const [, tenantId, membershipId] = memberMatch;
    if (!isUuid(tenantId) || !isUuid(membershipId)) return json({ error: "invalid_member" }, 422);
    const invalidOrigin = verifyMutation(request);
    if (invalidOrigin) return invalidOrigin;
    const parsed = parseMembershipUpdate(await request.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, 422);

    try {
      const result = await updateMember(tenantId, membershipId, user.id, parsed.value.role);
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "not_found") return json({ error: "member_not_found" }, 404);
      if (result.state === "last_owner") return json({ error: "last_owner" }, 409);
      return json({ member: result.member });
    } catch (error) {
      console.error("team_member_update_failed", { requestId: context.requestId, tenantId, membershipId, error });
      return json({ error: "team_member_update_failed", requestId: context.requestId }, 500);
    }
  }

  return json({ error: "not_found" }, 404);
};

export const config: Config = {
  path: [
    "/api/team/claim",
    "/api/team/:tenantId",
    "/api/team/:tenantId/invitations",
    "/api/team/:tenantId/members/:membershipId",
  ],
};
