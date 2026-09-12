import type { Config, Context } from "@netlify/functions";
import { AuthError, verifyRequestOrigin, type User } from "@netlify/identity";
import { isResponse, json, requireUser } from "./_shared/auth.ts";
import { isUuid, withSession, type DatabaseClient } from "./_shared/database.ts";
import { parseSponsorDecision } from "./_shared/sponsor-portal-input.ts";

type AccessRow = { tenant_id: string; sponsor_id: string };

const responseRoute = /^\/api\/sponsor-portal\/([0-9a-f-]+)\/([0-9a-f-]+)\/respond$/i;

function verifyMutation(request: Request): Response | null {
  try {
    verifyRequestOrigin(request);
    return null;
  } catch (error) {
    return json({ error: "invalid_request_origin" }, (error as AuthError).status ?? 403);
  }
}

async function claimInvitations(user: User) {
  const email = user.email?.trim().toLowerCase();
  if (!email) return { error: "verified_email_required" as const };
  const claimed = await withSession(user.id, null, async (client) => {
    const invitations = await client.query<{ id: string; tenant_id: string; sponsor_id: string }>(`
      SELECT id, tenant_id, sponsor_id
      FROM sponsor_portal_invitations
      WHERE lower(email) = lower($1) AND expires_at > now()
      ORDER BY created_at
    `, [email]);
    let count = 0;
    for (const invitation of invitations.rows) {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [invitation.tenant_id]);
      await client.query(`
        INSERT INTO sponsor_portal_access (tenant_id, sponsor_id, identity_user_id, email)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (tenant_id, sponsor_id, identity_user_id) DO UPDATE SET email = EXCLUDED.email
      `, [invitation.tenant_id, invitation.sponsor_id, user.id, email]);
      await client.query("UPDATE sponsor_portal_invitations SET accepted_at = COALESCE(accepted_at, now()), updated_at = now() WHERE tenant_id = $1 AND id = $2", [invitation.tenant_id, invitation.id]);
      count += 1;
    }
    const contractInvitations = await client.query<{ id: string; tenant_id: string; sponsor_id: string }>(`
      SELECT id, tenant_id, sponsor_id
      FROM contract_signing_requests
      WHERE lower(signer_email) = lower($1)
        AND access_invited_at IS NOT NULL AND access_expires_at > now()
        AND access_accepted_at IS NULL
      ORDER BY created_at
    `, [email]);
    for (const invitation of contractInvitations.rows) {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [invitation.tenant_id]);
      await client.query(`INSERT INTO sponsor_portal_access (tenant_id, sponsor_id, identity_user_id, email)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (tenant_id, sponsor_id, identity_user_id) DO UPDATE SET email = EXCLUDED.email`,
      [invitation.tenant_id, invitation.sponsor_id, user.id, email]);
      await client.query(`UPDATE contract_signing_requests SET access_status = 'accepted',
        access_accepted_at = COALESCE(access_accepted_at, now()), updated_at = now()
        WHERE tenant_id = $1 AND id = $2`, [invitation.tenant_id, invitation.id]);
      count += 1;
    }
    return count;
  }, email);
  return { claimed };
}

async function loadSpace(client: DatabaseClient, tenantId: string, sponsorId: string, userId: string) {
  const access = await client.query<{ id: string }>(`
    SELECT id FROM sponsor_portal_access
    WHERE tenant_id = $1 AND sponsor_id = $2 AND identity_user_id = $3 LIMIT 1
  `, [tenantId, sponsorId, userId]);
  if (!access.rows[0]) return null;

  const sponsor = await client.query<{ id: string; legal_name: string; contact_email: string | null; tenant_name: string }>(`
    SELECT sponsor.id, sponsor.legal_name, sponsor.contact_email, tenant.name AS tenant_name
    FROM sponsors sponsor JOIN tenants tenant ON tenant.id = sponsor.tenant_id
    WHERE sponsor.tenant_id = $1 AND sponsor.id = $2 LIMIT 1
  `, [tenantId, sponsorId]);
  if (!sponsor.rows[0]) return null;

  const proposal = await client.query<{
    id: string; campaign_name: string; target_period: string; response_deadline: string | null;
    source_package: string; source_value_cents: number; proposed_package: string; proposed_value_cents: number;
    proposed_package_version_id: string | null; status: string; updated_at: string;
  }>(`
    SELECT proposal.id, campaign.name AS campaign_name, campaign.target_period, campaign.response_deadline::text,
           proposal.source_package, proposal.source_value_cents, proposal.proposed_package, proposal.proposed_value_cents,
           proposal.proposed_package_version_id, proposal.status, proposal.updated_at::text
    FROM transition_sponsors proposal
    JOIN transition_campaigns campaign ON campaign.id = proposal.campaign_id AND campaign.tenant_id = proposal.tenant_id
    WHERE proposal.tenant_id = $1 AND proposal.sponsor_id = $2
      AND proposal.status IN ('sent', 'opened', 'question', 'confirmed', 'declined')
    ORDER BY proposal.updated_at DESC LIMIT 1
  `, [tenantId, sponsorId]);

  const current = proposal.rows[0] ?? null;
  if (current?.status === "sent") {
    await client.query("UPDATE transition_sponsors SET status = 'opened', updated_at = now() WHERE tenant_id = $1 AND id = $2 AND status = 'sent'", [tenantId, current.id]);
    current.status = "opened";
  }

  const versions = await client.query<{
    id: string; name: string; description: string | null; price_cents: number; duration_months: number;
    payment_plan: string; capacity: number | null; reserved_quantity: string;
  }>(`
    SELECT version.id, version.name, version.description, version.price_cents, version.duration_months,
           version.payment_plan, version.capacity,
           COALESCE((SELECT sum(reservation.quantity)::text
             FROM sponsorship_package_reservations reservation
             WHERE reservation.tenant_id = version.tenant_id AND reservation.package_version_id = version.id
               AND reservation.status IN ('held', 'confirmed')
               AND (reservation.status = 'confirmed' OR reservation.expires_at IS NULL OR reservation.expires_at > now())), '0') AS reserved_quantity
    FROM sponsorship_package_versions version
    JOIN sponsorship_packages package ON package.id = version.package_id AND package.tenant_id = version.tenant_id
    WHERE version.tenant_id = $1 AND version.status = 'published' AND version.visibility = 'public'
      AND package.status = 'active'
      AND (version.valid_from IS NULL OR version.valid_from <= CURRENT_DATE)
      AND (version.valid_until IS NULL OR version.valid_until >= CURRENT_DATE)
    ORDER BY version.price_cents, lower(version.name)
  `, [tenantId]);
  const rights = await client.query<{ package_version_id: string; id: string; name: string; description: string | null; quantity: number; schedule_text: string | null; channel: string | null; location: string | null }>(`
    SELECT package_version_id, id, name, description, quantity, schedule_text, channel, location
    FROM sponsorship_rights WHERE tenant_id = $1 AND package_version_id = ANY($2::uuid[])
    ORDER BY package_version_id, created_at, id
  `, [tenantId, versions.rows.map((version) => version.id)]);
  const contracts = await client.query<{
    id: string; contract_number: string; title: string; status: "released" | "confirmed";
    package_name: string; price_cents: string; snapshot_hash: string;
    released_at: string | null; confirmed_at: string | null; signer_name: string | null;
    signer_role: string | null; can_confirm: boolean;
  }>(`
    SELECT contract.id, contract.contract_number, contract.title, contract.status,
           contract.package_snapshot->>'name' AS package_name,
           contract.package_snapshot->>'priceCents' AS price_cents,
           contract.snapshot_hash, contract.released_at::text, contract.confirmed_at::text,
           signing.signer_name, signing.signer_role,
           (signing.id IS NULL OR (signing.delivery_mode = 'account' AND lower(signing.signer_email) = app_current_user_email())) AS can_confirm
    FROM sponsorship_contracts contract
    LEFT JOIN contract_signing_requests signing
      ON signing.tenant_id = contract.tenant_id AND signing.contract_id = contract.id
    WHERE contract.tenant_id = $1 AND contract.sponsor_id = $2 AND contract.status IN ('released', 'confirmed')
    ORDER BY contract.created_at DESC
  `, [tenantId, sponsorId]);

  return {
    tenantId,
    sponsor: sponsor.rows[0],
    proposal: current,
    contracts: contracts.rows.map((contract) => ({ ...contract, price_cents: Number(contract.price_cents) })),
    catalog: versions.rows.map((version) => ({
      ...version,
      available_quantity: version.capacity === null ? null : Math.max(0, version.capacity - Number(version.reserved_quantity)),
      rights: rights.rows.filter((right) => right.package_version_id === version.id),
    })),
  };
}

async function listSpaces(user: User) {
  return withSession(user.id, null, async (client) => {
    const accesses = await client.query<AccessRow>(`
      SELECT tenant_id, sponsor_id FROM sponsor_portal_access
      WHERE identity_user_id = $1 ORDER BY created_at
    `, [user.id]);
    const spaces = [];
    for (const access of accesses.rows) {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [access.tenant_id]);
      const space = await loadSpace(client, access.tenant_id, access.sponsor_id, user.id);
      if (space) spaces.push(space);
    }
    return spaces;
  }, user.email ?? undefined);
}

export default async (request: Request, context: Context) => {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const pathname = new URL(request.url).pathname;

  if (pathname === "/api/sponsor-portal/claim") {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const invalidOrigin = verifyMutation(request);
    if (invalidOrigin) return invalidOrigin;
    try {
      const result = await claimInvitations(user);
      return "error" in result ? json({ error: result.error }, 422) : json(result);
    } catch (error) {
      console.error("sponsor_portal_claim_failed", { requestId: context.requestId, userId: user.id, error });
      return json({ error: "sponsor_portal_claim_failed", requestId: context.requestId }, 500);
    }
  }

  if (pathname === "/api/sponsor-portal" && request.method === "GET") {
    try {
      return json({ spaces: await listSpaces(user) });
    } catch (error) {
      console.error("sponsor_portal_load_failed", { requestId: context.requestId, userId: user.id, error });
      return json({ error: "sponsor_portal_load_failed", requestId: context.requestId }, 500);
    }
  }

  const match = pathname.match(responseRoute);
  if (!match) return json({ error: "route_not_found" }, 404);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const invalidOrigin = verifyMutation(request);
  if (invalidOrigin) return invalidOrigin;
  const tenantId = match[1];
  const transitionSponsorId = match[2];
  if (!isUuid(tenantId) || !isUuid(transitionSponsorId)) return json({ error: "invalid_target" }, 422);
  const parsed = parseSponsorDecision(await request.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, 422);

  try {
    const result = await withSession(user.id, tenantId, async (client) => {
      const proposalResult = await client.query<{
        id: string; sponsor_id: string; proposed_package_version_id: string | null; status: string;
      }>(`
        SELECT proposal.id, proposal.sponsor_id, proposal.proposed_package_version_id, proposal.status
        FROM transition_sponsors proposal
        JOIN sponsor_portal_access access ON access.tenant_id = proposal.tenant_id AND access.sponsor_id = proposal.sponsor_id
        WHERE proposal.tenant_id = $1 AND proposal.id = $2 AND access.identity_user_id = $3
        LIMIT 1
      `, [tenantId, transitionSponsorId, user.id]);
      const proposal = proposalResult.rows[0];
      if (!proposal) return { state: "not_found" as const };
      if (["confirmed", "declined"].includes(proposal.status)) return { state: "already_answered" as const };

      if (parsed.value.decision === "advice" || parsed.value.decision === "decline") {
        const status = parsed.value.decision === "advice" ? "question" : "declined";
        await client.query("UPDATE transition_sponsors SET status = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2", [tenantId, transitionSponsorId, status]);
        await client.query("UPDATE sponsorship_package_reservations SET status = 'released', updated_at = now() WHERE tenant_id = $1 AND transition_sponsor_id = $2 AND status = 'held'", [tenantId, transitionSponsorId]);
        await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, $3, 'transition_sponsor', $4::text, jsonb_build_object('decision', $5::text))`,
          [tenantId, user.id, `sponsor.${parsed.value.decision}`, transitionSponsorId, parsed.value.decision]);
        return { state: "updated" as const, sponsorId: proposal.sponsor_id };
      }

      const selected = await client.query<{ id: string; name: string; price_cents: number }>(`
        SELECT id, name, price_cents FROM sponsorship_package_versions
        WHERE tenant_id = $1 AND id = $2 AND status = 'published' AND visibility = 'public'
          AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
          AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
        LIMIT 1
      `, [tenantId, parsed.value.packageVersionId]);
      const version = selected.rows[0];
      if (!version) return { state: "invalid_version" as const };
      if (parsed.value.decision === "accept" && version.id !== proposal.proposed_package_version_id) {
        return { state: "proposal_mismatch" as const };
      }

      const existing = await client.query<{ id: string }>(`
        SELECT id FROM sponsorship_package_reservations
        WHERE tenant_id = $1 AND transition_sponsor_id = $2 AND status IN ('held', 'confirmed') LIMIT 1
      `, [tenantId, transitionSponsorId]);
      if (existing.rows[0]) {
        await client.query(`UPDATE sponsorship_package_reservations
          SET package_version_id = $3, status = 'confirmed', expires_at = NULL, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`, [tenantId, existing.rows[0].id, version.id]);
      } else {
        await client.query(`INSERT INTO sponsorship_package_reservations
          (tenant_id, package_version_id, sponsor_id, transition_sponsor_id, status, created_by)
          VALUES ($1, $2, $3, $4, 'confirmed', $5)`,
          [tenantId, version.id, proposal.sponsor_id, transitionSponsorId, user.id]);
      }
      await client.query(`UPDATE transition_sponsors
        SET proposed_package = $3, proposed_value_cents = $4, proposed_package_version_id = $5,
            status = 'confirmed', updated_at = now()
        WHERE tenant_id = $1 AND id = $2`, [tenantId, transitionSponsorId, version.name, version.price_cents, version.id]);
      await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
        VALUES ($1, $2, 'sponsor.confirmed', 'transition_sponsor', $3::text,
                jsonb_build_object('decision', $4::text, 'package_version_id', $5::text, 'acknowledged', true))`,
        [tenantId, user.id, transitionSponsorId, parsed.value.decision, version.id]);
      return { state: "updated" as const, sponsorId: proposal.sponsor_id };
    }, user.email ?? undefined);

    if (result.state === "not_found") return json({ error: "sponsor_proposal_not_found" }, 404);
    if (result.state === "already_answered") return json({ error: "sponsor_proposal_already_answered" }, 409);
    if (result.state === "invalid_version") return json({ error: "published_package_version_required" }, 409);
    if (result.state === "proposal_mismatch") return json({ error: "proposal_package_mismatch" }, 409);
    const spaces = await listSpaces(user);
    return json({ space: spaces.find((space) => space.tenantId === tenantId && space.sponsor.id === result.sponsorId) ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("package_capacity_exceeded")) return json({ error: "package_capacity_exceeded" }, 409);
    if (message.includes("package_exclusivity_conflict")) return json({ error: "package_exclusivity_conflict" }, 409);
    console.error("sponsor_portal_response_failed", { requestId: context.requestId, tenantId, transitionSponsorId, error });
    return json({ error: "sponsor_portal_response_failed", requestId: context.requestId }, 500);
  }
};

export const config: Config = {
  path: [
    "/api/sponsor-portal",
    "/api/sponsor-portal/claim",
    "/api/sponsor-portal/:tenantId/:transitionSponsorId/respond",
  ],
};
