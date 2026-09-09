import type { Config, Context } from "@netlify/functions";
import { AuthError, verifyRequestOrigin } from "@netlify/identity";
import { hasPermission, isResponse, json, requireUser, type MembershipRole } from "./_shared/auth.ts";
import { isUuid, withSession, type DatabaseClient } from "./_shared/database.ts";
import { parseCampaignInput, parseCampaignStatusInput, parseMappingInput, parseTransitionSponsorInput } from "./_shared/transition-input.ts";

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
           proposal.proposed_value_cents, proposal.status, proposal.exception_note, proposal.updated_at::text
    FROM transition_sponsors proposal
    JOIN sponsors sponsor ON sponsor.id = proposal.sponsor_id AND sponsor.tenant_id = proposal.tenant_id
    WHERE proposal.tenant_id = $1 AND proposal.campaign_id = $2
    ORDER BY sponsor.legal_name, proposal.id
  `, [tenantId, campaignId]);

  return { campaign, summary: summaryResult.rows[0], mappings: mappings.rows, sponsors: sponsors.rows };
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
  const tenantId = collectionMatch?.[1] ?? campaignMatch?.[1] ?? mappingMatch?.[1] ?? sponsorMatch?.[1];
  const campaignId = campaignMatch?.[2] ?? mappingMatch?.[2] ?? sponsorMatch?.[2];
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
          const open = await client.query<{ count: string }>(`
            SELECT count(*)::text AS count FROM transition_sponsors
            WHERE tenant_id = $1 AND campaign_id = $2 AND status = 'review'
          `, [tenantId, campaignId]);
          if (Number(open.rows[0]?.count ?? 0) > 0) return { state: "not_ready" as const, open: Number(open.rows[0].count) };
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
      if (result.state === "not_ready") return json({ error: "campaign_has_open_reviews", open: result.open }, 409);
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
        const mapping = await client.query<{ source_package: string }>(`
          UPDATE transition_mappings
          SET target_package = $4, target_value_cents = $5, updated_at = now()
          WHERE tenant_id = $1 AND campaign_id = $2 AND id = $3
            AND EXISTS (
              SELECT 1 FROM transition_campaigns campaign
              WHERE campaign.tenant_id = $1 AND campaign.id = $2 AND campaign.status NOT IN ('active', 'closed')
            )
          RETURNING source_package
        `, [tenantId, campaignId, mappingId, parsed.value.targetPackage, parsed.value.targetValueCents]);
        if (!mapping.rows[0]) return { state: "not_found" as const };
        const affected = await client.query<{ count: string }>(`
          WITH changed AS (
            UPDATE transition_sponsors
            SET proposed_package = $4, proposed_value_cents = $5, status = 'review', updated_at = now()
            WHERE tenant_id = $1 AND campaign_id = $2 AND source_package = $3 AND status IN ('review', 'ready')
            RETURNING id
          ) SELECT count(*)::text AS count FROM changed
        `, [tenantId, campaignId, mapping.rows[0].source_package, parsed.value.targetPackage, parsed.value.targetValueCents]);
        await client.query("UPDATE transition_campaigns SET status = 'review', updated_at = now() WHERE tenant_id = $1 AND id = $2 AND status = 'ready'", [tenantId, campaignId]);
        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'transition.mapping_updated', 'transition_mapping', $3::text,
                  jsonb_build_object('target_package', $4::text, 'target_value_cents', $5::integer, 'affected', $6::integer))
        `, [tenantId, user.id, mappingId, parsed.value.targetPackage, parsed.value.targetValueCents, Number(affected.rows[0]?.count ?? 0)]);
        return { state: "updated" as const, detail: await campaignDetail(client, tenantId, campaignId) };
      });
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
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
        const updated = await client.query<{ id: string }>(`
          UPDATE transition_sponsors
          SET proposed_package = $4, proposed_value_cents = $5, status = $6,
              exception_note = $7, updated_at = now()
          WHERE tenant_id = $1 AND campaign_id = $2 AND id = $3
            AND EXISTS (
              SELECT 1 FROM transition_campaigns campaign
              WHERE campaign.tenant_id = $1 AND campaign.id = $2 AND campaign.status NOT IN ('active', 'closed')
            )
          RETURNING id
        `, [tenantId, campaignId, transitionSponsorId, parsed.value.proposedPackage, parsed.value.proposedValueCents, parsed.value.status, parsed.value.exceptionNote]);
        if (!updated.rows[0]) return { state: "not_found" as const };
        await client.query("UPDATE transition_campaigns SET updated_at = now() WHERE tenant_id = $1 AND id = $2", [tenantId, campaignId]);
        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'transition.sponsor_updated', 'transition_sponsor', $3::text,
                  jsonb_build_object('status', $4::text, 'proposed_package', $5::text, 'proposed_value_cents', $6::integer))
        `, [tenantId, user.id, transitionSponsorId, parsed.value.status, parsed.value.proposedPackage, parsed.value.proposedValueCents]);
        return { state: "updated" as const, detail: await campaignDetail(client, tenantId, campaignId) };
      });
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "not_found") return json({ error: "transition_sponsor_not_found" }, 404);
      return json({ detail: result.detail });
    } catch (error) {
      console.error("transition_sponsor_failed", { requestId: context.requestId, tenantId, campaignId, transitionSponsorId, error });
      return json({ error: "transition_sponsor_failed", requestId: context.requestId }, 500);
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
  ],
};
