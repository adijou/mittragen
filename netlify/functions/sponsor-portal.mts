import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { AuthError, getIdentityConfig, verifyRequestOrigin, type User } from "@netlify/identity";
import { isResponse, json, requireUser } from "./_shared/auth.ts";
import { isUuid, withSession, type DatabaseClient } from "./_shared/database.ts";
import { validateLogoUpload } from "./_shared/logo-upload.ts";
import { parseSponsorDecision } from "./_shared/sponsor-portal-input.ts";
import { claimContractSpaces, parseSponsorAddress, updateSponsorAddress } from "./_shared/sponsor-self-service.ts";
import { claimSponsorInvitations } from "./_shared/sponsor-access-invitations.ts";
import { verifySponsorIdentity } from "./_shared/sponsor-identity.ts";

type AccessRow = { tenant_id: string; sponsor_id: string };

const responseRoute = /^\/api\/sponsor-portal\/([0-9a-f-]+)\/([0-9a-f-]+)\/respond$/i;
const logoRoute = /^\/api\/sponsor-portal\/([0-9a-f-]+)\/([0-9a-f-]+)\/logo$/i;
const addressRoute = /^\/api\/sponsor-portal\/([0-9a-f-]+)\/([0-9a-f-]+)\/address$/i;
const BRAND_ASSET_STORE = "tenant-brand-assets";

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
  if (!email || !user.confirmedAt) return { error: "verified_email_required" as const };
  const claimed = await withSession(user.id, null, async (client) => {
    let count = await claimSponsorInvitations(client, user);
    count += await claimContractSpaces(client, user);
    const access = await client.query<{ present: boolean; workspace: boolean }>(`SELECT
      EXISTS (SELECT 1 FROM sponsor_portal_access WHERE identity_user_id = $1) AS present,
      EXISTS (SELECT 1 FROM tenant_memberships WHERE identity_user_id = $1) AS workspace`, [user.id]);
    return { claimed: count, hasAccess: access.rows[0].present, hasWorkspace: access.rows[0].workspace };
  }, email);
  return claimed;
}

async function loadSpace(client: DatabaseClient, tenantId: string, sponsorId: string, userId: string) {
  const access = await client.query<{ id: string }>(`
    SELECT id FROM sponsor_portal_access
    WHERE tenant_id = $1 AND sponsor_id = $2 AND identity_user_id = $3 LIMIT 1
  `, [tenantId, sponsorId, userId]);
  if (!access.rows[0]) return null;

  const sponsor = await client.query<{
    id: string; legal_name: string; contact_email: string | null; tenant_name: string;
    logo_available: boolean; logo_updated_at: string | null;
    street: string | null; postal_code: string | null; city: string | null;
  }>(`
    SELECT sponsor.id, sponsor.legal_name, sponsor.contact_email, tenant.name AS tenant_name,
           sponsor.street, sponsor.postal_code, sponsor.city,
           (sponsor.logo_blob_key IS NOT NULL) AS logo_available, sponsor.logo_updated_at::text
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
    sponsor: {
      id: sponsor.rows[0].id,
      legal_name: sponsor.rows[0].legal_name,
      contact_email: sponsor.rows[0].contact_email,
      tenant_name: sponsor.rows[0].tenant_name,
      address: { street: sponsor.rows[0].street, postal_code: sponsor.rows[0].postal_code, city: sponsor.rows[0].city },
      logoAvailable: sponsor.rows[0].logo_available,
      logoUpdatedAt: sponsor.rows[0].logo_updated_at,
    },
    proposal: current,
    contracts: contracts.rows.map((contract) => ({ ...contract, price_cents: Number(contract.price_cents) })),
    catalog: versions.rows.map((version) => ({
      ...version,
      available_quantity: version.capacity === null ? null : Math.max(0, version.capacity - Number(version.reserved_quantity)),
      rights: rights.rows.filter((right) => right.package_version_id === version.id),
    })),
  };
}

async function sponsorLogoRecord(client: DatabaseClient, tenantId: string, sponsorId: string, userId: string, lock = false) {
  const result = await client.query<{
    logo_blob_key: string | null;
    logo_content_type: "image/png" | "image/jpeg" | null;
    logo_updated_at: string | null;
  }>(`
    SELECT sponsor.logo_blob_key, sponsor.logo_content_type, sponsor.logo_updated_at::text
    FROM sponsors sponsor
    JOIN sponsor_portal_access access
      ON access.tenant_id = sponsor.tenant_id AND access.sponsor_id = sponsor.id
    WHERE sponsor.tenant_id = $1 AND sponsor.id = $2 AND access.identity_user_id = $3
    LIMIT 1${lock ? " FOR UPDATE OF sponsor" : ""}
  `, [tenantId, sponsorId, userId]);
  return result.rows[0] ?? null;
}

async function handleSponsorLogo(request: Request, context: Context, user: User, tenantId: string, sponsorId: string) {
  if (!isUuid(tenantId) || !isUuid(sponsorId)) return json({ error: "invalid_target" }, 422);

  if (request.method === "GET") {
    try {
      const row = await withSession(user.id, tenantId, (client) => sponsorLogoRecord(client, tenantId, sponsorId, user.id), user.email ?? undefined);
      if (!row) return json({ error: "sponsor_access_denied" }, 403);
      if (!row.logo_blob_key || !row.logo_content_type) return json({ error: "sponsor_logo_not_found" }, 404);
      const data = await getStore({ name: BRAND_ASSET_STORE, consistency: "strong" })
        .get(row.logo_blob_key, { type: "arrayBuffer" }) as ArrayBuffer | null;
      if (!data) return json({ error: "sponsor_logo_not_found" }, 404);
      return new Response(data, { headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": row.logo_content_type,
        "X-Content-Type-Options": "nosniff",
      } });
    } catch (error) {
      console.error("sponsor_logo_load_failed", { requestId: context.requestId, tenantId, sponsorId, userId: user.id, error });
      return json({ error: "sponsor_logo_load_failed", requestId: context.requestId }, 500);
    }
  }

  if (request.method !== "POST" && request.method !== "DELETE") return json({ error: "method_not_allowed" }, 405);
  const invalidOrigin = verifyMutation(request);
  if (invalidOrigin) return invalidOrigin;
  const store = getStore({ name: BRAND_ASSET_STORE, consistency: "strong" });

  if (request.method === "DELETE") {
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const current = await sponsorLogoRecord(client, tenantId, sponsorId, user.id, true);
        if (!current) return { state: "denied" as const };
        if (!current.logo_blob_key) return { state: "not_found" as const };
        await client.query(`UPDATE sponsors
          SET logo_blob_key = NULL, logo_content_type = NULL, logo_updated_at = NULL, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`, [tenantId, sponsorId]);
        await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1,$2,'sponsor.logo_deleted','sponsor',$3::text,'{}'::jsonb)`, [tenantId, user.id, sponsorId]);
        return { state: "deleted" as const, oldKey: current.logo_blob_key };
      }, user.email ?? undefined);
      if (result.state === "denied") return json({ error: "sponsor_access_denied" }, 403);
      if (result.state === "not_found") return json({ error: "sponsor_logo_not_found" }, 404);
      try { await store.delete(result.oldKey); }
      catch (error) { console.error("sponsor_old_logo_cleanup_failed", { tenantId, sponsorId, error }); }
      return json({ logo: { available: false, updatedAt: null } });
    } catch (error) {
      console.error("sponsor_logo_delete_failed", { requestId: context.requestId, tenantId, sponsorId, userId: user.id, error });
      return json({ error: "sponsor_logo_delete_failed", requestId: context.requestId }, 500);
    }
  }

  const form = await request.formData().catch(() => null);
  const validated = await validateLogoUpload(form?.get("logo"));
  if (!validated.ok) return json({ error: validated.error }, 422);

  let allowed: boolean;
  try {
    allowed = await withSession(user.id, tenantId, async (client) => Boolean(
      await sponsorLogoRecord(client, tenantId, sponsorId, user.id),
    ), user.email ?? undefined);
  } catch (error) {
    console.error("sponsor_logo_access_failed", { requestId: context.requestId, tenantId, sponsorId, userId: user.id, error });
    return json({ error: "sponsor_logo_access_failed", requestId: context.requestId }, 500);
  }
  if (!allowed) return json({ error: "sponsor_access_denied" }, 403);

  const newKey = `sponsor-logos/${tenantId}/${sponsorId}/${crypto.randomUUID()}`;
  let blobSaved = false;
  try {
    await store.set(newKey, validated.value.buffer, { metadata: {
      contentType: validated.value.contentType,
      uploadedAt: new Date().toISOString(),
    } });
    blobSaved = true;
    const result = await withSession(user.id, tenantId, async (client) => {
      const current = await sponsorLogoRecord(client, tenantId, sponsorId, user.id, true);
      if (!current) return { state: "denied" as const };
      const updated = await client.query<{ logo_updated_at: string }>(`UPDATE sponsors
        SET logo_blob_key = $3, logo_content_type = $4, logo_updated_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING logo_updated_at::text`, [tenantId, sponsorId, newKey, validated.value.contentType]);
      await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
        VALUES ($1,$2,'sponsor.logo_updated','sponsor',$3::text,
          jsonb_build_object('content_type',$4::text,'size_bytes',$5::integer))`,
      [tenantId, user.id, sponsorId, validated.value.contentType, validated.value.size]);
      return { state: "saved" as const, oldKey: current.logo_blob_key, updatedAt: updated.rows[0].logo_updated_at };
    }, user.email ?? undefined);
    if (result.state === "denied") {
      await store.delete(newKey).catch(() => undefined);
      return json({ error: "sponsor_access_denied" }, 403);
    }
    if (result.oldKey && result.oldKey !== newKey) {
      try { await store.delete(result.oldKey); }
      catch (error) { console.error("sponsor_old_logo_cleanup_failed", { tenantId, sponsorId, error }); }
    }
    return json({ logo: { available: true, updatedAt: result.updatedAt } });
  } catch (error) {
    if (blobSaved) await store.delete(newKey).catch(() => undefined);
    console.error("sponsor_logo_save_failed", { requestId: context.requestId, tenantId, sponsorId, userId: user.id, error });
    return json({ error: "sponsor_logo_save_failed", requestId: context.requestId }, 500);
  }
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
  if (!user.confirmedAt) return json({ error: "verified_email_required" }, 403);
  const pathname = new URL(request.url).pathname;
  const logoMatch = pathname.match(logoRoute);

  if (logoMatch) return handleSponsorLogo(request, context, user, logoMatch[1], logoMatch[2]);

  const addressMatch = pathname.match(addressRoute);
  if (addressMatch) {
    if (request.method !== "PATCH") return json({ error: "method_not_allowed" }, 405);
    const invalidOrigin = verifyMutation(request);
    if (invalidOrigin) return invalidOrigin;
    const [, tenantId, sponsorId] = addressMatch;
    if (!isUuid(tenantId) || !isUuid(sponsorId)) return json({ error: "invalid_target" }, 422);
    const parsed = parseSponsorAddress(await request.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId,
        (client) => updateSponsorAddress(client, tenantId, sponsorId, user.id, parsed.value), user.email);
      if (result.state === "denied") return json({ error: "sponsor_access_denied" }, 403);
      if (result.state === "conflict") return json({ error: "sponsor_address_conflict" }, 409);
      return json({ address: result.address });
    } catch (error) {
      console.error("sponsor_address_update_failed", { requestId: context.requestId, tenantId, sponsorId, error });
      return json({ error: "sponsor_address_update_failed", requestId: context.requestId }, 500);
    }
  }

  if (pathname === "/api/sponsor-portal/claim") {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const invalidOrigin = verifyMutation(request);
    if (invalidOrigin) return invalidOrigin;
    try {
      const accessToken = context.cookies.get("nf_jwt")
        ?? request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
      const verified = await verifySponsorIdentity(user, accessToken, getIdentityConfig()?.url);
      if (verified.error) return json({ error: verified.error, requestId: context.requestId }, verified.status);
      const result = await claimInvitations(verified.user);
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
    "/api/sponsor-portal/:tenantId/:sponsorId/logo",
    "/api/sponsor-portal/:tenantId/:sponsorId/address",
  ],
};
