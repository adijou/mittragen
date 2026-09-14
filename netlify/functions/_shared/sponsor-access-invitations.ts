import type { User } from "@netlify/identity";
import type { DatabaseClient } from "./database.ts";
import { hasPermission, type MembershipRole } from "./permissions.ts";

export function parseSponsorAccessInvitation(body: unknown):
  | { ok: true; email: string }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "email")) return { ok: false, error: "invalid_body" };
  if (typeof value.email !== "string" || /[\u0000-\u001f\u007f]/.test(value.email)) return { ok: false, error: "invalid_contact_email" };
  const email = value.email.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "invalid_contact_email" };
  return { ok: true, email };
}

async function canManage(client: DatabaseClient, tenantId: string, userId: string) {
  const membership = await client.query<{ role: MembershipRole }>(
    "SELECT role FROM tenant_memberships WHERE tenant_id = $1 AND identity_user_id = $2", [tenantId, userId],
  );
  return Boolean(membership.rows[0] && hasPermission(membership.rows[0].role, "sponsors:write"));
}

export async function loadSponsorAccess(client: DatabaseClient, tenantId: string, sponsorId: string, userId: string) {
  if (!await canManage(client, tenantId, userId)) return { state: "denied" as const };
  const sponsor = await client.query("SELECT id FROM sponsors WHERE tenant_id = $1 AND id = $2", [tenantId, sponsorId]);
  if (!sponsor.rows[0]) return { state: "not_found" as const };
  const accounts = await client.query<{ email: string; created_at: string }>(`
    SELECT email, created_at::text FROM sponsor_portal_access
    WHERE tenant_id = $1 AND sponsor_id = $2 ORDER BY created_at, id`, [tenantId, sponsorId]);
  const invitations = await client.query<{
    id: string; email: string; delivery_status: "pending" | "sent" | "failed";
    sent_at: string | null; accepted_at: string | null; expires_at: string;
  }>(`SELECT id, email, delivery_status, sent_at::text, accepted_at::text, expires_at::text
    FROM sponsor_portal_invitations WHERE tenant_id = $1 AND sponsor_id = $2
      AND transition_sponsor_id IS NULL ORDER BY updated_at DESC, id`, [tenantId, sponsorId]);
  return { state: "ready" as const, accounts: accounts.rows, invitations: invitations.rows };
}

export async function prepareSponsorAccessInvitation(
  client: DatabaseClient, tenantId: string, sponsorId: string, userId: string, email: string,
) {
  if (!await canManage(client, tenantId, userId)) return { state: "denied" as const };
  // Serialize requests for the same sponsor, including two first-time invitations.
  const sponsor = await client.query<{ legal_name: string; tenant_name: string }>(`
    SELECT sponsor.legal_name, tenant.name AS tenant_name FROM sponsors sponsor
    JOIN tenants tenant ON tenant.id = sponsor.tenant_id
    WHERE sponsor.tenant_id = $1 AND sponsor.id = $2 FOR UPDATE OF sponsor`, [tenantId, sponsorId]);
  if (!sponsor.rows[0]) return { state: "not_found" as const };
  const recent = await client.query(`SELECT id FROM sponsor_portal_invitations
    WHERE tenant_id = $1 AND sponsor_id = $2 AND lower(email) = $3 AND transition_sponsor_id IS NULL
      AND ((delivery_status = 'pending' AND updated_at > now() - interval '2 minutes')
        OR (delivery_status = 'sent' AND sent_at > now() - interval '1 minute'))`, [tenantId, sponsorId, email]);
  if (recent.rows[0]) return { state: "busy" as const };
  const invitation = await client.query<{ id: string; email: string; expires_at: string; updated_at: string }>(`
    INSERT INTO sponsor_portal_invitations (tenant_id, sponsor_id, email, expires_at, invited_by)
    VALUES ($1,$2,$3,now() + interval '7 days',$4)
    ON CONFLICT (tenant_id, sponsor_id, lower(email)) WHERE transition_sponsor_id IS NULL
    DO UPDATE SET expires_at = EXCLUDED.expires_at, invited_by = EXCLUDED.invited_by,
      delivery_status = 'pending', delivery_error = NULL, resend_email_id = NULL, sent_at = NULL, updated_at = now()
    RETURNING id, email, expires_at::text, updated_at::text`, [tenantId, sponsorId, email, userId]);
  await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
    VALUES ($1,$2,'sponsor.access_invitation_prepared','sponsor',$3::text,jsonb_build_object('email',$4::text))`,
  [tenantId, userId, sponsorId, email]);
  return { state: "ready" as const, ...sponsor.rows[0], invitation: invitation.rows[0] };
}

export async function recordSponsorAccessDelivery(
  client: DatabaseClient, tenantId: string, sponsorId: string, userId: string,
  invitation: { id: string; updated_at: string }, result: { emailId: string } | { error: string },
) {
  const sent = "emailId" in result;
  // A delayed delivery result must not overwrite a newer attempt.
  const updated = await client.query<{ email: string }>(`UPDATE sponsor_portal_invitations
    SET delivery_status = $5, delivery_error = $6, resend_email_id = $7,
      sent_at = CASE WHEN $5 = 'sent' THEN now() ELSE NULL END, updated_at = now()
    WHERE tenant_id = $1 AND sponsor_id = $2 AND id = $3 AND updated_at = $4::timestamptz
      AND transition_sponsor_id IS NULL AND delivery_status = 'pending'
    RETURNING email`, [tenantId, sponsorId, invitation.id, invitation.updated_at,
    sent ? "sent" : "failed", sent ? null : result.error, sent ? result.emailId : null]);
  if (!updated.rows[0]) throw new Error("invitation_delivery_conflict");
  await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
    VALUES ($1,$2,$3,'sponsor',$4::text,jsonb_build_object('email',$5::text,'invitation_id',$6::text))`,
  [tenantId, userId, sent ? "sponsor.access_invitation_sent" : "sponsor.access_invitation_failed",
    sponsorId, updated.rows[0].email, invitation.id]);
}

export async function claimSponsorInvitations(client: DatabaseClient, user: Pick<User, "id" | "email" | "confirmedAt">) {
  const email = user.email?.trim().toLowerCase();
  if (!email || !user.confirmedAt) return 0;
  const candidates = await client.query<{ id: string; tenant_id: string; sponsor_id: string }>(`
    SELECT id, tenant_id, sponsor_id FROM sponsor_portal_invitations
    WHERE lower(email) = $1 AND expires_at > now() AND delivery_status = 'sent' AND accepted_at IS NULL
    ORDER BY created_at, id`, [email]);
  let count = 0;
  for (const invitation of candidates.rows) {
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [invitation.tenant_id]);
    const accepted = await client.query(`UPDATE sponsor_portal_invitations SET accepted_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND lower(email) = $3 AND expires_at > now()
        AND delivery_status = 'sent' AND accepted_at IS NULL RETURNING id`, [invitation.tenant_id, invitation.id, email]);
    if (!accepted.rows[0]) continue;
    await client.query(`INSERT INTO sponsor_portal_access (tenant_id, sponsor_id, identity_user_id, email)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (tenant_id, sponsor_id, identity_user_id) DO UPDATE SET email = EXCLUDED.email`,
    [invitation.tenant_id, invitation.sponsor_id, user.id, email]);
    await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
      VALUES ($1,$2,'sponsor.access_activated','sponsor',$3::text,
        jsonb_build_object('source','sponsor_invitation','invitation_id',$4::text))`,
    [invitation.tenant_id, user.id, invitation.sponsor_id, invitation.id]);
    count += 1;
  }
  return count;
}
