import type { Config, Context } from "@netlify/functions";
import { AuthError, verifyRequestOrigin } from "@netlify/identity";
import { hasPermission, isResponse, json, requireUser, type MembershipRole } from "./_shared/auth.ts";
import { isUuid, withSession, type DatabaseClient } from "./_shared/database.ts";
import { parseBookingCancellation, parseEventSponsoringSettings, parsePackageAllocation, parseSponsorshipEvent } from "./_shared/event-sponsoring-input.ts";
import { createEventFlyerPdf, type EventFlyerPdfData } from "./_shared/event-flyer-pdf.ts";
import { loadOrganizationPdfBrand } from "./_shared/organization-pdf-brand.ts";
import { getOrganizationProfile, mapOrganizationProfile } from "./_shared/organization-profile.ts";

type SettingsRow = { public_key: string; headline: string; season_label: string | null; introduction: string; terms_text: string; is_published: boolean; updated_at: string };
type EventRow = { id: string; team_name: string; opponent: string; competition: string | null; venue: string | null; starts_at: string; time_tbd: boolean; price_cents: number; fn_supplement_cents: number; status: "draft" | "published" | "cancelled"; created_at: string; home_coach: string | null; opponent_coach: string | null; referee_name: string | null; match_info_url: string | null; speaker_note: string | null };
type BookingRow = { id: string; event_id: string; reference: string; sponsor_id: string | null; sponsor_name: string; address: string; postal_code: string; city: string; contact_name: string; contact_email: string; contact_phone: string | null; referred_by_member: string | null; include_fn_mention: boolean; payment_mode: "invoice" | "cash"; amount_cents: number; submitted_at: string };
type AllocationRow = { id: string; event_id: string; sponsor_id: string; sponsor_name: string; package_version_id: string; package_name: string; sponsorship_right_id: string; right_name: string; season_key: string; note: string | null; allocated_at: string };
type EntitlementRow = { sponsor_id: string; sponsor_name: string; package_version_id: string; package_name: string; right_id: string; right_name: string; allowance: number; used_count: string };

const routes = {
  allocationCancel: /^\/api\/event-sponsoring\/([0-9a-f-]+)\/events\/([0-9a-f-]+)\/allocations\/([0-9a-f-]+)\/cancel$/i,
  allocations: /^\/api\/event-sponsoring\/([0-9a-f-]+)\/events\/([0-9a-f-]+)\/allocations$/i,
  bookingCancel: /^\/api\/event-sponsoring\/([0-9a-f-]+)\/events\/([0-9a-f-]+)\/bookings\/([0-9a-f-]+)\/cancel$/i,
  legacyBooking: /^\/api\/event-sponsoring\/([0-9a-f-]+)\/events\/([0-9a-f-]+)\/booking$/i,
  flyer: /^\/api\/event-sponsoring\/([0-9a-f-]+)\/events\/([0-9a-f-]+)\/flyer$/i,
  event: /^\/api\/event-sponsoring\/([0-9a-f-]+)\/events\/([0-9a-f-]+)$/i,
  events: /^\/api\/event-sponsoring\/([0-9a-f-]+)\/events$/i,
  settings: /^\/api\/event-sponsoring\/([0-9a-f-]+)\/settings$/i,
  collection: /^\/api\/event-sponsoring\/([0-9a-f-]+)$/i,
};

async function membershipRole(client: DatabaseClient, tenantId: string, userId: string) {
  const result = await client.query<{ role: MembershipRole }>("SELECT role FROM tenant_memberships WHERE tenant_id = $1 AND identity_user_id = $2 LIMIT 1", [tenantId, userId]);
  return result.rows[0]?.role ?? null;
}

function verifyMutation(request: Request): Response | null {
  try { verifyRequestOrigin(request); return null; }
  catch (error) { return json({ error: "invalid_request_origin" }, (error as AuthError).status ?? 403); }
}

function publicUrl(request: Request, key: string) {
  const base = Netlify.env.get("URL")?.trim() || new URL(request.url).origin;
  return new URL(`/matchball/${key}`, base).toString();
}

function seasonKey(settings: SettingsRow, startsAt?: string) {
  if (settings.season_label?.trim()) return settings.season_label.trim();
  const date = startsAt ? new Date(startsAt) : new Date();
  return Number.isNaN(date.valueOf()) ? String(new Date().getUTCFullYear()) : String(date.getUTCFullYear());
}

async function getSettings(client: DatabaseClient, tenantId: string) {
  const result = await client.query<SettingsRow>("SELECT public_key, headline, season_label, introduction, terms_text, is_published, updated_at::text FROM tenant_event_sponsoring_settings WHERE tenant_id = $1 LIMIT 1", [tenantId]);
  return result.rows[0] ?? null;
}

async function listEvents(client: DatabaseClient, tenantId: string) {
  const [events, bookings, allocations] = await Promise.all([
    client.query<EventRow>(`SELECT id, team_name, opponent, competition, venue, starts_at::text, time_tbd, price_cents, fn_supplement_cents, status, created_at::text, home_coach, opponent_coach, referee_name, match_info_url, speaker_note FROM sponsorship_events WHERE tenant_id = $1 ORDER BY starts_at, lower(team_name), lower(opponent)`, [tenantId]),
    client.query<BookingRow>(`SELECT id, event_id, reference, sponsor_id, sponsor_name, address, postal_code, city, contact_name, contact_email, contact_phone, referred_by_member, include_fn_mention, payment_mode, amount_cents, submitted_at::text FROM event_sponsorship_bookings WHERE tenant_id = $1 AND status = 'submitted' ORDER BY submitted_at, id`, [tenantId]),
    client.query<AllocationRow>(`SELECT allocation.id, allocation.event_id, allocation.sponsor_id, sponsor.legal_name AS sponsor_name, allocation.package_version_id, version.name AS package_name, allocation.sponsorship_right_id, right_item.name AS right_name, allocation.season_key, allocation.note, allocation.allocated_at::text
      FROM event_package_allocations allocation
      JOIN sponsors sponsor ON sponsor.id = allocation.sponsor_id AND sponsor.tenant_id = allocation.tenant_id
      JOIN sponsorship_package_versions version ON version.id = allocation.package_version_id AND version.tenant_id = allocation.tenant_id
      JOIN sponsorship_rights right_item ON right_item.id = allocation.sponsorship_right_id AND right_item.tenant_id = allocation.tenant_id
      WHERE allocation.tenant_id = $1 AND allocation.status = 'allocated' ORDER BY allocation.allocated_at, allocation.id`, [tenantId]),
  ]);
  return events.rows.map((event) => ({
    id: event.id, teamName: event.team_name, opponent: event.opponent, competition: event.competition,
    venue: event.venue, startsAt: event.starts_at, timeTbd: event.time_tbd, priceCents: event.price_cents,
    fnSupplementCents: event.fn_supplement_cents, status: event.status, createdAt: event.created_at,
    homeCoach: event.home_coach, opponentCoach: event.opponent_coach, refereeName: event.referee_name,
    matchInfoUrl: event.match_info_url, speakerNote: event.speaker_note,
    sponsors: [
      ...bookings.rows.filter((item) => item.event_id === event.id).map((item) => ({ id: item.id, kind: "direct" as const, reference: item.reference, sponsorId: item.sponsor_id, sponsorName: item.sponsor_name, address: item.address, postalCode: item.postal_code, city: item.city, contactName: item.contact_name, contactEmail: item.contact_email, contactPhone: item.contact_phone, referredByMember: item.referred_by_member, includeFnMention: item.include_fn_mention, paymentMode: item.payment_mode, amountCents: item.amount_cents, assignedAt: item.submitted_at })),
      ...allocations.rows.filter((item) => item.event_id === event.id).map((item) => ({ id: item.id, kind: "package" as const, sponsorId: item.sponsor_id, sponsorName: item.sponsor_name, packageVersionId: item.package_version_id, packageName: item.package_name, rightId: item.sponsorship_right_id, rightName: item.right_name, seasonKey: item.season_key, note: item.note, assignedAt: item.allocated_at })),
    ].sort((left, right) => left.assignedAt.localeCompare(right.assignedAt)),
  }));
}

async function listEntitlements(client: DatabaseClient, tenantId: string, currentSeason: string) {
  const result = await client.query<EntitlementRow>(`WITH sponsor_packages AS (
      SELECT sponsor.id AS sponsor_id, sponsor.legal_name AS sponsor_name, sponsor.assigned_package_version_id AS package_version_id
      FROM sponsors sponsor WHERE sponsor.tenant_id = $1 AND sponsor.status <> 'inactive' AND sponsor.assigned_package_version_id IS NOT NULL
      UNION
      SELECT sponsor.id, sponsor.legal_name, contract.package_version_id FROM sponsorship_contracts contract
      JOIN sponsors sponsor ON sponsor.id = contract.sponsor_id AND sponsor.tenant_id = contract.tenant_id
      WHERE contract.tenant_id = $1 AND contract.status IN ('released', 'confirmed') AND sponsor.status <> 'inactive'
    )
    SELECT source.sponsor_id, source.sponsor_name, source.package_version_id, version.name AS package_name,
           right_item.id AS right_id, right_item.name AS right_name,
           GREATEST(right_item.quantity, COALESCE(((regexp_match(
             lower(concat_ws(' ', right_item.name, right_item.description, right_item.schedule_text, right_item.channel)),
             '([0-9]+)[^0-9]{0,30}(matchball|matchspiel|heimspiel)'
           ))[1])::integer, 0)) AS allowance,
           count(allocation.id)::text AS used_count
    FROM sponsor_packages source
    JOIN sponsorship_package_versions version ON version.id = source.package_version_id AND version.tenant_id = $1
    JOIN sponsorship_rights right_item ON right_item.package_version_id = source.package_version_id AND right_item.tenant_id = $1
    LEFT JOIN event_package_allocations allocation ON allocation.tenant_id = $1 AND allocation.sponsor_id = source.sponsor_id
      AND allocation.sponsorship_right_id = right_item.id AND allocation.season_key = $2 AND allocation.status = 'allocated'
    WHERE lower(concat_ws(' ', right_item.name, right_item.description)) ~ 'match[ -]?ball'
    GROUP BY source.sponsor_id, source.sponsor_name, source.package_version_id, version.name, right_item.id, right_item.name, right_item.quantity, right_item.description, right_item.schedule_text, right_item.channel
    ORDER BY lower(source.sponsor_name), lower(version.name), lower(right_item.name)`, [tenantId, currentSeason]);
  return result.rows.map((row) => ({ sponsorId: row.sponsor_id, sponsorName: row.sponsor_name, packageVersionId: row.package_version_id, packageName: row.package_name, rightId: row.right_id, rightName: row.right_name, allowance: row.allowance, usedCount: Number(row.used_count), remainingCount: Math.max(0, row.allowance - Number(row.used_count)) }));
}

async function listPartners(client: DatabaseClient, tenantId: string) {
  const result = await client.query<{ sponsor_name: string; package_name: string }>(`SELECT sponsor.legal_name AS sponsor_name, version.name AS package_name FROM sponsors sponsor
    JOIN sponsorship_package_versions version ON version.id = sponsor.assigned_package_version_id AND version.tenant_id = sponsor.tenant_id
    WHERE sponsor.tenant_id = $1 AND sponsor.status <> 'inactive'
    ORDER BY CASE WHEN lower(version.name) LIKE '%gold%' THEN 1 WHEN lower(version.name) LIKE '%silber%' THEN 2 WHEN lower(version.name) LIKE '%bronze%' THEN 3 ELSE 4 END, lower(sponsor.legal_name)`, [tenantId]);
  return result.rows.map((row) => ({ sponsorName: row.sponsor_name, packageName: row.package_name }));
}

function mapSettings(row: SettingsRow, request: Request) {
  return { publicKey: row.public_key, publicUrl: publicUrl(request, row.public_key), headline: row.headline, seasonLabel: row.season_label, introduction: row.introduction, termsText: row.terms_text, isPublished: row.is_published, updatedAt: row.updated_at };
}

async function loadData(client: DatabaseClient, tenantId: string, request: Request) {
  const settings = await getSettings(client, tenantId);
  if (!settings) return null;
  const tenant = await client.query<{ name: string; slug: string }>("SELECT name, slug FROM tenants WHERE id = $1 LIMIT 1", [tenantId]);
  if (!tenant.rows[0]) return null;
  return { tenant: tenant.rows[0], settings: mapSettings(settings, request), events: await listEvents(client, tenantId), entitlements: await listEntitlements(client, tenantId, seasonKey(settings)) };
}

function databaseCode(error: unknown) { return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : ""; }
function databaseMessage(error: unknown) { return error && typeof error === "object" && "message" in error ? String((error as { message?: unknown }).message ?? "") : ""; }

export default async (request: Request, context: Context) => {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const pathname = new URL(request.url).pathname;
  const matches = Object.fromEntries(Object.entries(routes).map(([key, route]) => [key, pathname.match(route)]));
  const routeMatch = Object.values(matches).find(Boolean) ?? null;
  const tenantId = routeMatch?.[1];
  const eventId = routeMatch?.[2];
  const itemId = routeMatch?.[3];
  if (!tenantId || !isUuid(tenantId)) return json({ error: "invalid_tenant" }, 422);
  if (eventId && !isUuid(eventId)) return json({ error: "invalid_event" }, 422);
  if (itemId && !isUuid(itemId)) return json({ error: "invalid_event_sponsor" }, 422);

  if (matches.collection && request.method === "GET") {
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "sponsors:read")) return { state: "denied" as const };
        return { state: "ready" as const, data: await loadData(client, tenantId, request) };
      }, user.email ?? undefined);
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (!result.data) return json({ error: "event_sponsoring_not_found" }, 404);
      return json({ eventSponsoring: result.data });
    } catch (error) {
      console.error("event_sponsoring_load_failed", { requestId: context.requestId, tenantId, error });
      return json({ error: "event_sponsoring_load_failed", requestId: context.requestId }, 500);
    }
  }

  if (matches.flyer && request.method === "GET") {
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "sponsors:read")) return { state: "denied" as const };
        const settings = await getSettings(client, tenantId);
        const event = (await listEvents(client, tenantId)).find((item) => item.id === eventId);
        const tenant = await client.query<{ name: string }>("SELECT name FROM tenants WHERE id = $1 LIMIT 1", [tenantId]);
        const organization = mapOrganizationProfile(await getOrganizationProfile(client, tenantId));
        if (!settings || !event || !tenant.rows[0]) return { state: "not_found" as const };
        const data: EventFlyerPdfData = {
          generatedAt: new Date().toISOString(), brand: await loadOrganizationPdfBrand(client, tenantId, context.requestId),
          organization: { name: tenant.rows[0].name, contactName: organization?.contactName ?? null, contactEmail: organization?.contactEmail ?? null, contactPhone: organization?.contactPhone ?? null, website: organization?.website ?? null },
          event: { teamName: event.teamName, opponent: event.opponent, competition: event.competition, venue: event.venue, startsAt: event.startsAt, timeTbd: event.timeTbd, homeCoach: event.homeCoach, opponentCoach: event.opponentCoach, refereeName: event.refereeName, matchInfoUrl: event.matchInfoUrl, speakerNote: event.speakerNote },
          matchballSponsors: event.sponsors.map((sponsor) => ({ sponsorName: sponsor.sponsorName, source: sponsor.kind, detail: sponsor.kind === "package" ? `${sponsor.packageName} · ${sponsor.rightName}` : sponsor.reference })),
          partners: await listPartners(client, tenantId), publicUrl: publicUrl(request, settings.public_key),
        };
        return { state: "ready" as const, bytes: await createEventFlyerPdf(data) };
      }, user.email ?? undefined);
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "not_found") return json({ error: "event_not_found" }, 404);
      return new Response(Uint8Array.from(result.bytes).buffer, { headers: { "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="matchinfo-${eventId}.pdf"`, "Content-Type": "application/pdf", "X-Content-Type-Options": "nosniff" } });
    } catch (error) {
      console.error("event_flyer_failed", { requestId: context.requestId, tenantId, eventId, error });
      return json({ error: "event_flyer_failed", requestId: context.requestId }, 500);
    }
  }

  if (!["POST", "PATCH"].includes(request.method)) return json({ error: "method_not_allowed" }, 405);
  const invalidOrigin = verifyMutation(request);
  if (invalidOrigin) return invalidOrigin;
  const body = await request.json().catch(() => null);

  if (matches.settings && request.method === "PATCH") {
    const parsed = parseEventSponsoringSettings(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "tenant:manage")) return { state: "denied" as const };
        const value = parsed.value;
        await client.query("UPDATE tenant_event_sponsoring_settings SET headline = $2, season_label = $3, introduction = $4, terms_text = $5, is_published = $6, updated_by = $7, updated_at = now() WHERE tenant_id = $1", [tenantId, value.headline, value.seasonLabel, value.introduction, value.termsText, value.isPublished, user.id]);
        await client.query("INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata) VALUES ($1,$2,'event_sponsoring.settings_updated','tenant_event_sponsoring_settings',$1::text,jsonb_build_object('is_published',$3::boolean))", [tenantId, user.id, value.isPublished]);
        return { state: "saved" as const, data: await loadData(client, tenantId, request) };
      }, user.email ?? undefined);
      return result.state === "denied" ? json({ error: "permission_denied" }, 403) : json({ eventSponsoring: result.data });
    } catch (error) { console.error("event_sponsoring_settings_save_failed", { requestId: context.requestId, tenantId, error }); return json({ error: "event_sponsoring_settings_save_failed", requestId: context.requestId }, 500); }
  }

  if (matches.events && request.method === "POST") {
    const parsed = parseSponsorshipEvent(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "fulfillment:write")) return { state: "denied" as const };
        const value = parsed.value;
        const created = await client.query<{ id: string }>(`INSERT INTO sponsorship_events (tenant_id, team_name, opponent, competition, venue, starts_at, time_tbd, price_cents, fn_supplement_cents, status, created_by, home_coach, opponent_coach, referee_name, match_info_url, speaker_note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`, [tenantId, value.teamName, value.opponent, value.competition, value.venue, value.startsAt, value.timeTbd, value.priceCents, value.fnSupplementCents, value.status, user.id, value.homeCoach, value.opponentCoach, value.refereeName, value.matchInfoUrl, value.speakerNote]);
        await client.query("INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata) VALUES ($1,$2,'event_sponsoring.event_created','sponsorship_event',$3::text,jsonb_build_object('opponent',$4::text,'starts_at',$5::text,'status',$6::text))", [tenantId, user.id, created.rows[0].id, value.opponent, value.startsAt, value.status]);
        return { state: "created" as const, data: await loadData(client, tenantId, request) };
      }, user.email ?? undefined);
      return result.state === "denied" ? json({ error: "permission_denied" }, 403) : json({ eventSponsoring: result.data }, 201);
    } catch (error) { console.error("event_sponsoring_event_create_failed", { requestId: context.requestId, tenantId, error }); return json({ error: "event_sponsoring_event_create_failed", requestId: context.requestId }, 500); }
  }

  if (matches.event && request.method === "PATCH") {
    const parsed = parseSponsorshipEvent(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "fulfillment:write")) return { state: "denied" as const };
        const value = parsed.value;
        const updated = await client.query<{ id: string }>(`UPDATE sponsorship_events SET team_name=$3, opponent=$4, competition=$5, venue=$6, starts_at=$7, time_tbd=$8, price_cents=$9, fn_supplement_cents=$10, status=$11, home_coach=$12, opponent_coach=$13, referee_name=$14, match_info_url=$15, speaker_note=$16, updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id`, [tenantId, eventId, value.teamName, value.opponent, value.competition, value.venue, value.startsAt, value.timeTbd, value.priceCents, value.fnSupplementCents, value.status, value.homeCoach, value.opponentCoach, value.refereeName, value.matchInfoUrl, value.speakerNote]);
        if (!updated.rows[0]) return { state: "not_found" as const };
        await client.query("INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata) VALUES ($1,$2,'event_sponsoring.event_updated','sponsorship_event',$3::text,jsonb_build_object('status',$4::text))", [tenantId, user.id, eventId, value.status]);
        return { state: "saved" as const, data: await loadData(client, tenantId, request) };
      }, user.email ?? undefined);
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "not_found") return json({ error: "event_not_found" }, 404);
      return json({ eventSponsoring: result.data });
    } catch (error) { console.error("event_sponsoring_event_update_failed", { requestId: context.requestId, tenantId, eventId, error }); return json({ error: "event_sponsoring_event_update_failed", requestId: context.requestId }, 500); }
  }

  if (matches.allocations && request.method === "POST") {
    const parsed = parsePackageAllocation(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "fulfillment:write")) return { state: "denied" as const };
        const settings = await getSettings(client, tenantId);
        const event = await client.query<{ starts_at: string }>("SELECT starts_at::text FROM sponsorship_events WHERE tenant_id=$1 AND id=$2 AND status<>'cancelled' LIMIT 1", [tenantId, eventId]);
        if (!settings || !event.rows[0]) return { state: "not_found" as const };
        const value = parsed.value;
        const created = await client.query<{ id: string }>("INSERT INTO event_package_allocations (tenant_id,event_id,sponsor_id,package_version_id,sponsorship_right_id,season_key,note,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id", [tenantId, eventId, value.sponsorId, value.packageVersionId, value.rightId, seasonKey(settings, event.rows[0].starts_at), value.note, user.id]);
        await client.query("INSERT INTO audit_events (tenant_id,actor_user_id,action,object_type,object_id,metadata) VALUES ($1,$2,'event_sponsoring.package_allocation_created','event_package_allocation',$3::text,jsonb_build_object('event_id',$4::text,'sponsor_id',$5::text,'package_version_id',$6::text,'sponsorship_right_id',$7::text))", [tenantId, user.id, created.rows[0].id, eventId, value.sponsorId, value.packageVersionId, value.rightId]);
        return { state: "saved" as const, data: await loadData(client, tenantId, request) };
      }, user.email ?? undefined);
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "not_found") return json({ error: "event_not_found" }, 404);
      return json({ eventSponsoring: result.data }, 201);
    } catch (error) {
      const message = databaseMessage(error);
      if (databaseCode(error) === "23505") return json({ error: "sponsor_already_assigned_to_event" }, 409);
      if (message.includes("matchball_entitlement_exhausted")) return json({ error: "matchball_entitlement_exhausted" }, 409);
      if (message.includes("entitlement_not_found")) return json({ error: "matchball_entitlement_not_found" }, 422);
      console.error("event_package_allocation_failed", { requestId: context.requestId, tenantId, eventId, error });
      return json({ error: "event_package_allocation_failed", requestId: context.requestId }, 500);
    }
  }

  if ((matches.bookingCancel || matches.allocationCancel || matches.legacyBooking) && request.method === "POST") {
    const parsed = parseBookingCancellation(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "fulfillment:write")) return { state: "denied" as const };
        if (matches.allocationCancel && itemId) {
          const updated = await client.query<{ id: string }>("UPDATE event_package_allocations SET status='cancelled',cancelled_at=now(),updated_at=now() WHERE tenant_id=$1 AND event_id=$2 AND id=$3 AND status='allocated' RETURNING id", [tenantId, eventId, itemId]);
          if (!updated.rows[0]) return { state: "not_found" as const };
          await client.query("INSERT INTO audit_events (tenant_id,actor_user_id,action,object_type,object_id,metadata) VALUES ($1,$2,'event_sponsoring.package_allocation_cancelled','event_package_allocation',$3::text,jsonb_build_object('event_id',$4::text))", [tenantId, user.id, updated.rows[0].id, eventId]);
        } else {
          let targetId = itemId;
          if (matches.legacyBooking) {
            const candidates = await client.query<{ id: string }>("SELECT id FROM event_sponsorship_bookings WHERE tenant_id=$1 AND event_id=$2 AND status='submitted' ORDER BY submitted_at", [tenantId, eventId]);
            if (candidates.rows.length > 1) return { state: "booking_id_required" as const };
            targetId = candidates.rows[0]?.id;
          }
          if (!targetId) return { state: "not_found" as const };
          const updated = await client.query<{ id: string }>("UPDATE event_sponsorship_bookings SET status='cancelled',cancelled_at=now(),updated_at=now() WHERE tenant_id=$1 AND event_id=$2 AND id=$3 AND status='submitted' RETURNING id", [tenantId, eventId, targetId]);
          if (!updated.rows[0]) return { state: "not_found" as const };
          await client.query("INSERT INTO audit_events (tenant_id,actor_user_id,action,object_type,object_id,metadata) VALUES ($1,$2,'event_sponsoring.booking_cancelled','event_sponsorship_booking',$3::text,jsonb_build_object('event_id',$4::text))", [tenantId, user.id, updated.rows[0].id, eventId]);
        }
        return { state: "saved" as const, data: await loadData(client, tenantId, request) };
      }, user.email ?? undefined);
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "booking_id_required") return json({ error: "booking_id_required" }, 409);
      if (result.state === "not_found") return json({ error: "event_sponsor_not_found" }, 404);
      return json({ eventSponsoring: result.data });
    } catch (error) { console.error("event_sponsor_cancel_failed", { requestId: context.requestId, tenantId, eventId, itemId, error }); return json({ error: "event_sponsor_cancel_failed", requestId: context.requestId }, 500); }
  }

  return json({ error: "method_not_allowed" }, 405);
};

export const config: Config = { path: [
  "/api/event-sponsoring/:tenantId", "/api/event-sponsoring/:tenantId/settings",
  "/api/event-sponsoring/:tenantId/events", "/api/event-sponsoring/:tenantId/events/:eventId",
  "/api/event-sponsoring/:tenantId/events/:eventId/flyer", "/api/event-sponsoring/:tenantId/events/:eventId/booking",
  "/api/event-sponsoring/:tenantId/events/:eventId/bookings/:itemId/cancel",
  "/api/event-sponsoring/:tenantId/events/:eventId/allocations",
  "/api/event-sponsoring/:tenantId/events/:eventId/allocations/:itemId/cancel",
] };
