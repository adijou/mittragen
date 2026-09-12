import type { Config, Context } from "@netlify/functions";
import { AuthError, verifyRequestOrigin } from "@netlify/identity";
import { hasPermission, isResponse, json, requireUser, type MembershipRole } from "./_shared/auth.ts";
import { isUuid, withSession, type DatabaseClient } from "./_shared/database.ts";
import { parseCampaignInput, parseCampaignStatusInput, parseMappingInput, parseTransitionSponsorInput } from "./_shared/transition-input.ts";
import { SponsorInvitationDeliveryError, sendSponsorInvitationEmail } from "./_shared/resend-sponsor-invitation.ts";

type CampaignRow = {
  id: string;
  name: string;
  target_period: string;
  response_deadline: string | null;
  status: "draft" | "review" | "ready" | "active" | "closed";
  created_at: string;
  updated_at: string;
};

type CampaignSummary = {
  sponsor_count: string;
  source_value_cents: string;
  proposed_value_cents: string;
  review_count: string;
  ready_count: string;
  exception_count: string;
};

type MappingRow = {
  id: string;
  source_package: string;
  target_package: string;
  target_value_cents: number;
  target_package_version_id: string | null;
  sponsor_count: string;
  source_value_cents: string;
};

type TransitionSponsorRow = {
  id: string;
  sponsor_id: string;
  legal_name: string;
  contact_email: string | null;
  source_organization: string | null;
  source_package: string;
  source_value_cents: number;
  proposed_package: string;
  proposed_value_cents: number;
  proposed_package_version_id: string | null;
  status: "review" | "ready" | "sent" | "opened" | "question" | "confirmed" | "declined" | "exception";
  exception_note: string | null;
  updated_at: string;
};

const campaignColumns = "id, name, target_period, response_deadline::text, status, created_at::text, updated_at::text";
const routes = {
  collection: /^\/api\/transitions\/([0-9a-f-]+)$/i,
  campaign: /^\/api\/transitions\/([0-9a-f-]+)\/([0-9a-f-]+)$/i,
  mapping: /^\/api\/transitions\/([0-9a-f-]+)\/([0-9a-f-]+)\/mappings\/([0-9a-f-]+)$/i,
  sponsor: /^\/api\/transitions\/([0-9a-f-]+)\/([0-9a-f-]+)\/sponsors\/([0-9a-f-]+)$/i,
  dispatch: /^\/api\/transitions\/([0-9a-f-]+)\/([0-9a-f-]+)\/dispatch$/i,
};

function verifyMutation(request: Request): Response | null {
  try {
    verifyRequestOrigin(request);
    return null;
  } catch (error) {
    return json({ error: "invalid_request_origin" }, (error as AuthError).status ?? 403);
  }
}

async function membershipRole(client: DatabaseClient, tenantId: string, userId: string) {
  const result = await client.query<{ role: MembershipRole }>(`
    SELECT role FROM tenant_memberships
    WHERE tenant_id = $1 AND identity_user_id = $2
    LIMIT 1
  `, [tenantId, userId]);
  return result.rows[0]?.role ?? null;
}

async function campaignDetail(client: DatabaseClient, tenantId: string, campaignId: string) {
  const campaignResult = await client.query<CampaignRow>(`
    SELECT ${campaignColumns}
    FROM transition_campaigns
    WHERE tenant_id = $1 AND id = $2
    LIMIT 1
  `, [tenantId, campaignId]);
  const campaign = campaignResult.rows[0];
  if (!campaign) return null;

  const summaryResult = await client.query<CampaignSummary>(`
    SELECT count(*)::text AS sponsor_count,
           COALESCE(sum(source_value_cents), 0)::text AS source_value_cents,
           COALESCE(sum(proposed_value_cents), 0)::text AS proposed_value_cents,
           count(*) FILTER (WHERE status = 'review')::text AS review_count,
           count(*) FILTER (WHERE status = 'ready')::text AS ready_count,
           count(*) FILTER (WHERE status = 'exception')::text AS exception_count
    FROM transition_sponsors
    WHERE tenant_id = $1 AND campaign_id = $2
  `, [tenantId, campaignId]);

  const mappings = await client.query<MappingRow>(`
    SELECT mapping.id, mapping.source_package, mapping.target_package, mapping.target_value_cents,
           mapping.target_package_version_id,
           count(proposal.id)::text AS sponsor_count,
           COALESCE(sum(proposal.source_value_cents), 0)::text AS source_value_cents
    FROM transition_mappings mapping
    LEFT JOIN transition_sponsors proposal
      ON proposal.tenant_id = mapping.tenant_id
     AND proposal.campaign_id = mapping.campaign_id
     AND proposal.source_package = mapping.source_package
    WHERE mapping.tenant_id = $1 AND mapping.campaign_id = $2
    GROUP BY mapping.id
    ORDER BY mapping.source_package
  `, [tenantId, campaignId]);

  const sponsors = await client.query<TransitionSponsorRow>(`
    SELECT proposal.id, proposal.sponsor_id, sponsor.legal_name, sponsor.contact_email, sponsor.source_organization,
           proposal.source_package, proposal.source_value_cents, proposal.proposed_package,
           proposal.proposed_value_cents, proposal.proposed_package_version_id,
           proposal.status, proposal.exception_note, proposal.updated_at::text
    FROM transition_sponsors proposal
    JOIN sponsors sponsor ON sponsor.id = proposal.sponsor_id AND sponsor.tenant_id = proposal.tenant_id
    WHERE proposal.tenant_id = $1 AND proposal.campaign_id = $2
    ORDER BY sponsor.legal_name, proposal.id
  `, [tenantId, campaignId]);

  const dispatchCheck = await client.query<{ missing_email_count: string; missing_package_count: string }>(`
    SELECT count(*) FILTER (WHERE proposal.status = 'ready' AND sponsor.contact_email IS NULL)::text AS missing_email_count,
           count(*) FILTER (WHERE proposal.status = 'ready' AND proposal.proposed_package_version_id IS NULL)::text AS missing_package_count
    FROM transition_sponsors proposal
    JOIN sponsors sponsor ON sponsor.id = proposal.sponsor_id AND sponsor.tenant_id = proposal.tenant_id
    WHERE proposal.tenant_id = $1 AND proposal.campaign_id = $2
  `, [tenantId, campaignId]);

  return { campaign, summary: summaryResult.rows[0], dispatch: dispatchCheck.rows[0], mappings: mappings.rows, sponsors: sponsors.rows };
}

async function publishedPackageVersion(client: DatabaseClient, tenantId: string, versionId: string) {
  const result = await client.query<{ id: string; name: string; price_cents: number }>(`
    SELECT id, name, price_cents
    FROM sponsorship_package_versions
    WHERE tenant_id = $1 AND id = $2 AND status = 'published' AND visibility = 'public'
      AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
      AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
    LIMIT 1
  `, [tenantId, versionId]);
  return result.rows[0] ?? null;
}

function resendConfig() {
  const apiKey = Netlify.env.get("RESEND_API_KEY")?.trim();
  if (!apiKey) throw new SponsorInvitationDeliveryError("resend_not_configured");
  return {
    apiKey,
    from: Netlify.env.get("MAIL_FROM")?.trim() || "mittragen.ch <noreply@news.mittragen.ch>",
    replyTo: Netlify.env.get("MAIL_REPLY_TO")?.trim() || undefined,
  };
}

async function listCampaigns(client: DatabaseClient, tenantId: string) {
  const campaigns = await client.query<CampaignRow & CampaignSummary>(`
    SELECT campaign.id, campaign.name, campaign.target_period, campaign.response_deadline::text,
           campaign.status, campaign.created_at::text, campaign.updated_at::text,
           count(proposal.id)::text AS sponsor_count,
           COALESCE(sum(proposal.source_value_cents), 0)::text AS source_value_cents,
           COALESCE(sum(proposal.proposed_value_cents), 0)::text AS proposed_value_cents,
           count(proposal.id) FILTER (WHERE proposal.status = 'review')::text AS review_count,
           count(proposal.id) FILTER (WHERE proposal.status = 'ready')::text AS ready_count,
           count(proposal.id) FILTER (WHERE proposal.status = 'exception')::text AS exception_count
    FROM transition_campaigns campaign
    LEFT JOIN transition_sponsors proposal
      ON proposal.tenant_id = campaign.tenant_id AND proposal.campaign_id = campaign.id
    WHERE campaign.tenant_id = $1
    GROUP BY campaign.id
    ORDER BY campaign.created_at DESC
  `, [tenantId]);
  return campaigns.rows;
}

export default async (request: Request, context: Context) => {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const pathname = new URL(request.url).pathname;
  const collectionMatch = pathname.match(routes.collection);
  const campaignMatch = pathname.match(routes.campaign);
  const mappingMatch = pathname.match(routes.mapping);
  const sponsorMatch = pathname.match(routes.sponsor);
  const dispatchMatch = pathname.match(routes.dispatch);
  const tenantId = collectionMatch?.[1] ?? campaignMatch?.[1] ?? mappingMatch?.[1] ?? sponsorMatch?.[1] ?? dispatchMatch?.[1];
  const campaignId = campaignMatch?.[2] ?? mappingMatch?.[2] ?? sponsorMatch?.[2] ?? dispatchMatch?.[2];
  if (!tenantId || !isUuid(tenantId)) return json({ error: "invalid_tenant" }, 422);
  if (campaignId && !isUuid(campaignId)) return json({ error: "invalid_campaign" }, 422);

  if (request.method === "GET") {
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "sponsors:read")) return { denied: true as const };
        return campaignId
          ? { detail: await campaignDetail(client, tenantId, campaignId) }
          : { campaigns: await listCampaigns(client, tenantId) };
      });
      if ("denied" in result) return json({ error: "permission_denied" }, 403);
      if ("detail" in result && !result.detail) return json({ error: "campaign_not_found" }, 404);
      return json(result);
    } catch (error) {
      console.error("transitions_load_failed", { requestId: context.requestId, tenantId, campaignId, error });
      return json({ error: "transitions_load_failed", requestId: context.requestId }, 500);
    }
  }

  if (!["POST", "PATCH"].includes(request.method)) return json({ error: "method_not_allowed" }, 405);
  const invalidOrigin = verifyMutation(request);
  if (invalidOrigin) return invalidOrigin;
  const body = await request.json().catch(() => null);

  if (collectionMatch && request.method === "POST") {
    const parsed = parseCampaignInput(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "sponsors:write")) return { state: "denied" as const };
        const sponsorCount = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM sponsors WHERE tenant_id = $1", [tenantId]);
        if (Number(sponsorCount.rows[0]?.count ?? 0) === 0) return { state: "no_sponsors" as const };

        const created = await client.query<CampaignRow>(`
          INSERT INTO transition_campaigns (tenant_id, name, target_period, response_deadline, created_by)
          VALUES ($1, $2, $3, $4::date, $5)
          RETURNING ${campaignColumns}
        `, [tenantId, parsed.value.name, parsed.value.targetPeriod, parsed.value.responseDeadline, user.id]);
        const campaign = created.rows[0];

        await client.query(`
          INSERT INTO transition_mappings (tenant_id, campaign_id, source_package, target_package, target_value_cents)
          SELECT $1, $2, source_package, source_package, round(avg(annual_value_cents))::integer
          FROM (
            SELECT COALESCE(NULLIF(trim(proposal_package), ''), 'Ohne Paket') AS source_package, annual_value_cents
            FROM sponsors WHERE tenant_id = $1
          ) source
          GROUP BY source_package
        `, [tenantId, campaign.id]);

        await client.query(`
          INSERT INTO transition_sponsors (
            tenant_id, campaign_id, sponsor_id, source_package, source_value_cents, proposed_package, proposed_value_cents
          )
          SELECT $1, $2, id, COALESCE(NULLIF(trim(proposal_package), ''), 'Ohne Paket'), annual_value_cents,
                 COALESCE(NULLIF(trim(proposal_package), ''), 'Ohne Paket'), annual_value_cents
          FROM sponsors WHERE tenant_id = $1
        `, [tenantId, campaign.id]);

        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'transition.created', 'transition_campaign', $3::text,
                  jsonb_build_object('name', $4::text, 'sponsors', $5::integer))
        `, [tenantId, user.id, campaign.id, campaign.name, Number(sponsorCount.rows[0].count)]);
        return { state: "created" as const, detail: await campaignDetail(client, tenantId, campaign.id) };
      });
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "no_sponsors") return json({ error: "campaign_requires_sponsors" }, 409);
      return json({ detail: result.detail }, 201);
    } catch (error) {
      console.error("transition_create_failed", { requestId: context.requestId, tenantId, error });
      return json({ error: "transition_create_failed", requestId: context.requestId }, 500);
    }
  }

  if (campaignMatch && request.method === "PATCH" && campaignId) {
    const parsed = parseCampaignStatusInput(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "sponsors:write")) return { state: "denied" as const };
        if (parsed.value.status === "ready") {
          const open = await client.query<{ review_count: string; ready_count: string; missing_email_count: string; missing_package_count: string }>(`
            SELECT count(*) FILTER (WHERE proposal.status = 'review')::text AS review_count,
                   count(*) FILTER (WHERE proposal.status = 'ready')::text AS ready_count,
                   count(*) FILTER (WHERE proposal.status = 'ready' AND sponsor.contact_email IS NULL)::text AS missing_email_count,
                   count(*) FILTER (WHERE proposal.status = 'ready' AND proposal.proposed_package_version_id IS NULL)::text AS missing_package_count
            FROM transition_sponsors proposal
            JOIN sponsors sponsor ON sponsor.id = proposal.sponsor_id AND sponsor.tenant_id = proposal.tenant_id
            WHERE proposal.tenant_id = $1 AND proposal.campaign_id = $2
          `, [tenantId, campaignId]);
          const check = open.rows[0];
          if (Number(check?.review_count ?? 0) > 0 || Number(check?.ready_count ?? 0) === 0 || Number(check?.missing_email_count ?? 0) > 0 || Number(check?.missing_package_count ?? 0) > 0) {
            return { state: "not_ready" as const, check };
          }
        }
        const updated = await client.query<{ id: string }>(`
          UPDATE transition_campaigns SET status = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status NOT IN ('active', 'closed')
          RETURNING id
        `, [tenantId, campaignId, parsed.value.status]);
        if (!updated.rows[0]) return { state: "not_found" as const };
        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'transition.status_changed', 'transition_campaign', $3::text, jsonb_build_object('status', $4::text))
        `, [tenantId, user.id, campaignId, parsed.value.status]);
        return { state: "updated" as const, detail: await campaignDetail(client, tenantId, campaignId) };
      });
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "not_found") return json({ error: "campaign_not_found" }, 404);
      if (result.state === "not_ready") return json({ error: "campaign_not_dispatchable", ...result.check }, 409);
      return json({ detail: result.detail });
    } catch (error) {
      console.error("transition_status_failed", { requestId: context.requestId, tenantId, campaignId, error });
      return json({ error: "transition_status_failed", requestId: context.requestId }, 500);
    }
  }

  if (mappingMatch && request.method === "PATCH" && campaignId) {
    const mappingId = mappingMatch[3];
    if (!isUuid(mappingId)) return json({ error: "invalid_mapping" }, 422);
    const parsed = parseMappingInput(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "sponsors:write")) return { state: "denied" as const };
        const selectedVersion = parsed.value.targetPackageVersionId
          ? await publishedPackageVersion(client, tenantId, parsed.value.targetPackageVersionId)
          : null;
        if (parsed.value.targetPackageVersionId && !selectedVersion) return { state: "invalid_version" as const };
        const targetPackage = selectedVersion?.name ?? parsed.value.targetPackage;
        const targetValueCents = selectedVersion?.price_cents ?? parsed.value.targetValueCents;
        const mapping = await client.query<{ source_package: string }>(`
          UPDATE transition_mappings
          SET target_package = $4, target_value_cents = $5, target_package_version_id = $6, updated_at = now()
          WHERE tenant_id = $1 AND campaign_id = $2 AND id = $3
            AND EXISTS (
              SELECT 1 FROM transition_campaigns campaign
              WHERE campaign.tenant_id = $1 AND campaign.id = $2 AND campaign.status NOT IN ('active', 'closed')
            )
          RETURNING source_package
        `, [tenantId, campaignId, mappingId, targetPackage, targetValueCents, selectedVersion?.id ?? null]);
        if (!mapping.rows[0]) return { state: "not_found" as const };
        const affected = await client.query<{ count: string }>(`
          WITH changed AS (
            UPDATE transition_sponsors
            SET proposed_package = $4, proposed_value_cents = $5, proposed_package_version_id = $6, status = 'review', updated_at = now()
            WHERE tenant_id = $1 AND campaign_id = $2 AND source_package = $3 AND status IN ('review', 'ready')
            RETURNING id
          ) SELECT count(*)::text AS count FROM changed
        `, [tenantId, campaignId, mapping.rows[0].source_package, targetPackage, targetValueCents, selectedVersion?.id ?? null]);
        await client.query("UPDATE transition_campaigns SET status = 'review', updated_at = now() WHERE tenant_id = $1 AND id = $2 AND status = 'ready'", [tenantId, campaignId]);
        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'transition.mapping_updated', 'transition_mapping', $3::text,
                  jsonb_build_object('target_package', $4::text, 'target_value_cents', $5::integer, 'affected', $6::integer))
        `, [tenantId, user.id, mappingId, targetPackage, targetValueCents, Number(affected.rows[0]?.count ?? 0)]);
        return { state: "updated" as const, detail: await campaignDetail(client, tenantId, campaignId) };
      });
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "invalid_version") return json({ error: "published_package_version_required" }, 409);
      if (result.state === "not_found") return json({ error: "mapping_not_found" }, 404);
      return json({ detail: result.detail });
    } catch (error) {
      console.error("transition_mapping_failed", { requestId: context.requestId, tenantId, campaignId, mappingId, error });
      return json({ error: "transition_mapping_failed", requestId: context.requestId }, 500);
    }
  }

  if (sponsorMatch && request.method === "PATCH" && campaignId) {
    const transitionSponsorId = sponsorMatch[3];
    if (!isUuid(transitionSponsorId)) return json({ error: "invalid_transition_sponsor" }, 422);
    const parsed = parseTransitionSponsorInput(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "sponsors:write")) return { state: "denied" as const };
        const selectedVersion = parsed.value.proposedPackageVersionId
          ? await publishedPackageVersion(client, tenantId, parsed.value.proposedPackageVersionId)
          : null;
        if (parsed.value.proposedPackageVersionId && !selectedVersion) return { state: "invalid_version" as const };
        if (parsed.value.status === "ready" && !selectedVersion) return { state: "version_required" as const };
        const proposedPackage = selectedVersion?.name ?? parsed.value.proposedPackage;
        const proposedValueCents = selectedVersion?.price_cents ?? parsed.value.proposedValueCents;
        const updated = await client.query<{ id: string }>(`
          UPDATE transition_sponsors
          SET proposed_package = $4, proposed_value_cents = $5, proposed_package_version_id = $6, status = $7,
              exception_note = $8, updated_at = now()
          WHERE tenant_id = $1 AND campaign_id = $2 AND id = $3
            AND EXISTS (
              SELECT 1 FROM transition_campaigns campaign
              WHERE campaign.tenant_id = $1 AND campaign.id = $2 AND campaign.status NOT IN ('active', 'closed')
            )
          RETURNING id
        `, [tenantId, campaignId, transitionSponsorId, proposedPackage, proposedValueCents, selectedVersion?.id ?? null, parsed.value.status, parsed.value.exceptionNote]);
        if (!updated.rows[0]) return { state: "not_found" as const };
        await client.query("UPDATE transition_campaigns SET updated_at = now() WHERE tenant_id = $1 AND id = $2", [tenantId, campaignId]);
        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'transition.sponsor_updated', 'transition_sponsor', $3::text,
                  jsonb_build_object('status', $4::text, 'proposed_package', $5::text, 'proposed_value_cents', $6::integer))
        `, [tenantId, user.id, transitionSponsorId, parsed.value.status, proposedPackage, proposedValueCents]);
        return { state: "updated" as const, detail: await campaignDetail(client, tenantId, campaignId) };
      });
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "invalid_version") return json({ error: "published_package_version_required" }, 409);
      if (result.state === "version_required") return json({ error: "proposal_package_version_required" }, 409);
      if (result.state === "not_found") return json({ error: "transition_sponsor_not_found" }, 404);
      return json({ detail: result.detail });
    } catch (error) {
      console.error("transition_sponsor_failed", { requestId: context.requestId, tenantId, campaignId, transitionSponsorId, error });
      return json({ error: "transition_sponsor_failed", requestId: context.requestId }, 500);
    }
  }

  if (dispatchMatch && request.method === "POST" && campaignId) {
    type Prepared = {
      invitation_id: string;
      email: string;
      legal_name: string;
      tenant_name: string;
      campaign_name: string;
      response_deadline: string | null;
      source_value_cents: number;
      proposed_value_cents: number;
      proposed_package: string;
    };
    try {
      const prepared = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "sponsors:write")) return { state: "denied" as const };
        const campaign = await client.query<{ status: string }>(
          "SELECT status FROM transition_campaigns WHERE tenant_id = $1 AND id = $2",
          [tenantId, campaignId],
        );
        if (campaign.rows[0]?.status !== "ready") return { state: "not_ready" as const };
        const candidates = await client.query<Prepared>(`
          WITH invitations AS (
            INSERT INTO sponsor_portal_invitations (
              tenant_id, sponsor_id, transition_sponsor_id, email, expires_at, invited_by
            )
            SELECT proposal.tenant_id, proposal.sponsor_id, proposal.id, lower(sponsor.contact_email),
                   now() + interval '14 days', $3
            FROM transition_sponsors proposal
            JOIN sponsors sponsor ON sponsor.id = proposal.sponsor_id AND sponsor.tenant_id = proposal.tenant_id
            JOIN sponsorship_package_versions version ON version.id = proposal.proposed_package_version_id AND version.tenant_id = proposal.tenant_id
            WHERE proposal.tenant_id = $1 AND proposal.campaign_id = $2 AND proposal.status = 'ready'
              AND sponsor.contact_email IS NOT NULL AND version.status = 'published' AND version.visibility = 'public'
            ON CONFLICT (transition_sponsor_id, email) DO UPDATE
              SET expires_at = now() + interval '14 days', delivery_status = 'pending', delivery_error = NULL,
                  resend_email_id = NULL, sent_at = NULL, updated_at = now()
            RETURNING id, transition_sponsor_id, email
          )
          SELECT invitations.id AS invitation_id, invitations.email, sponsor.legal_name, tenant.name AS tenant_name,
                 campaign.name AS campaign_name, campaign.response_deadline::text,
                 proposal.source_value_cents, proposal.proposed_value_cents, proposal.proposed_package
          FROM invitations
          JOIN transition_sponsors proposal ON proposal.id = invitations.transition_sponsor_id
          JOIN sponsors sponsor ON sponsor.id = proposal.sponsor_id
          JOIN transition_campaigns campaign ON campaign.id = proposal.campaign_id
          JOIN tenants tenant ON tenant.id = proposal.tenant_id
        `, [tenantId, campaignId, user.id]);
        if (candidates.rows.length === 0) return { state: "empty" as const };
        return { state: "prepared" as const, invitations: candidates.rows };
      });
      if (prepared.state === "denied") return json({ error: "permission_denied" }, 403);
      if (prepared.state === "not_ready") return json({ error: "campaign_not_ready" }, 409);
      if (prepared.state === "empty") return json({ error: "campaign_has_no_dispatchable_sponsors" }, 409);

      const siteUrl = Netlify.env.get("URL")?.trim() || new URL(request.url).origin;
      const portalUrl = new URL("/sponsor", siteUrl).toString();
      const config = resendConfig();
      let sent = 0;
      let failed = 0;
      for (const invitation of prepared.invitations) {
        try {
          const resendEmailId = await sendSponsorInvitationEmail({
            email: invitation.email,
            sponsorName: invitation.legal_name,
            organizationName: invitation.tenant_name,
            campaignName: invitation.campaign_name,
            packageName: invitation.proposed_package,
            sourceValueCents: invitation.source_value_cents,
            proposedValueCents: invitation.proposed_value_cents,
            responseDeadline: invitation.response_deadline,
            portalUrl,
          }, config);
          await withSession(user.id, tenantId, async (client) => {
            await client.query(
              "UPDATE sponsor_portal_invitations SET delivery_status = 'sent', resend_email_id = $3, sent_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2",
              [tenantId, invitation.invitation_id, resendEmailId],
            );
            await client.query(`
              UPDATE transition_sponsors SET status = 'sent', updated_at = now()
              WHERE tenant_id = $1 AND campaign_id = $2
                AND id = (SELECT transition_sponsor_id FROM sponsor_portal_invitations WHERE tenant_id = $1 AND id = $3)
            `, [tenantId, campaignId, invitation.invitation_id]);
          });
          sent += 1;
        } catch (error) {
          failed += 1;
          await withSession(user.id, tenantId, async (client) => {
            await client.query(
              "UPDATE sponsor_portal_invitations SET delivery_status = 'failed', delivery_error = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2",
              [tenantId, invitation.invitation_id, error instanceof Error ? error.message.slice(0, 1000) : "delivery_failed"],
            );
          });
        }
      }
      await withSession(user.id, tenantId, async (client) => {
        if (sent > 0 && failed === 0) {
          await client.query("UPDATE transition_campaigns SET status = 'active', updated_at = now() WHERE tenant_id = $1 AND id = $2", [tenantId, campaignId]);
        }
        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'transition.dispatched', 'transition_campaign', $3::text,
                  jsonb_build_object('sent', $4::integer, 'failed', $5::integer))
        `, [tenantId, user.id, campaignId, sent, failed]);
      });
      return json({ sent, failed }, failed > 0 && sent === 0 ? 502 : 200);
    } catch (error) {
      console.error("transition_dispatch_failed", { requestId: context.requestId, tenantId, campaignId, error });
      const code = error instanceof SponsorInvitationDeliveryError && error.message === "resend_not_configured"
        ? "resend_not_configured"
        : "transition_dispatch_failed";
      return json({ error: code, requestId: context.requestId }, code === "resend_not_configured" ? 503 : 500);
    }
  }

  return json({ error: "route_not_found" }, 404);
};

export const config: Config = {
  path: [
    "/api/transitions/:tenantId",
    "/api/transitions/:tenantId/:campaignId",
    "/api/transitions/:tenantId/:campaignId/mappings/:mappingId",
    "/api/transitions/:tenantId/:campaignId/sponsors/:transitionSponsorId",
    "/api/transitions/:tenantId/:campaignId/dispatch",
  ],
};
