import type { Config, Context } from "@netlify/functions";
import { AuthError, verifyRequestOrigin } from "@netlify/identity";
import { hasPermission, isResponse, json, requireUser, type MembershipRole } from "./_shared/auth.ts";
import { createDossierPdf, type DossierPdfData } from "./_shared/dossier-pdf.ts";
import { dossierMissingFields, parseDossierProfile, type DossierProfileInput } from "./_shared/dossier-input.ts";
import { isUuid, withSession, type DatabaseClient } from "./_shared/database.ts";

type ProfileRow = {
  headline: string | null;
  season_label: string | null;
  introduction: string | null;
  club_portrait: string | null;
  sponsorship_impact: string | null;
  audience: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  updated_at: string | null;
};

type PackageRow = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  duration_months: number;
  payment_plan: string;
};

type RightRow = {
  package_version_id: string;
  name: string;
  description: string | null;
  quantity: number;
  schedule_text: string | null;
  channel: string | null;
  location: string | null;
};

const routes = {
  dossier: /^\/api\/dossier\/([0-9a-f-]+)$/i,
  pdf: /^\/api\/dossier\/([0-9a-f-]+)\/pdf$/i,
};

async function membershipRole(client: DatabaseClient, tenantId: string, userId: string) {
  const result = await client.query<{ role: MembershipRole }>(`
    SELECT role FROM tenant_memberships
    WHERE tenant_id = $1 AND identity_user_id = $2
    LIMIT 1
  `, [tenantId, userId]);
  return result.rows[0]?.role ?? null;
}

function mapProfile(row: ProfileRow | undefined, tenantName: string): DossierProfileInput & { updatedAt: string | null } {
  return {
    headline: row?.headline ?? `Sponsoring bei ${tenantName}`,
    seasonLabel: row?.season_label ?? null,
    introduction: row?.introduction ?? null,
    clubPortrait: row?.club_portrait ?? null,
    sponsorshipImpact: row?.sponsorship_impact ?? null,
    audience: row?.audience ?? null,
    contactName: row?.contact_name ?? null,
    contactEmail: row?.contact_email ?? null,
    contactPhone: row?.contact_phone ?? null,
    website: row?.website ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

async function dossierData(client: DatabaseClient, tenantId: string) {
  const tenant = await client.query<{ name: string; slug: string }>(`
    SELECT name, slug FROM tenants WHERE id = $1 LIMIT 1
  `, [tenantId]);
  if (!tenant.rows[0]) return null;
  const profileResult = await client.query<ProfileRow>(`
    SELECT headline, season_label, introduction, club_portrait, sponsorship_impact, audience,
           contact_name, contact_email, contact_phone, website, updated_at::text
    FROM tenant_sponsoring_profiles WHERE tenant_id = $1 LIMIT 1
  `, [tenantId]);
  const packages = await client.query<PackageRow>(`
    SELECT version.id, version.name, version.description, version.price_cents,
           version.duration_months, version.payment_plan
    FROM sponsorship_package_versions version
    JOIN sponsorship_packages package ON package.id = version.package_id AND package.tenant_id = version.tenant_id
    WHERE version.tenant_id = $1 AND version.status = 'published' AND version.visibility = 'public'
      AND package.status = 'active'
      AND (version.valid_from IS NULL OR version.valid_from <= CURRENT_DATE)
      AND (version.valid_until IS NULL OR version.valid_until >= CURRENT_DATE)
    ORDER BY version.price_cents DESC, lower(version.name), version.version_number DESC
  `, [tenantId]);
  const rights = packages.rows.length ? await client.query<RightRow>(`
    SELECT package_version_id, name, description, quantity, schedule_text, channel, location
    FROM sponsorship_rights
    WHERE tenant_id = $1 AND package_version_id = ANY($2::uuid[])
    ORDER BY package_version_id, created_at, id
  `, [tenantId, packages.rows.map((item) => item.id)]) : { rows: [] as RightRow[] };
  const profile = mapProfile(profileResult.rows[0], tenant.rows[0].name);
  return {
    tenant: tenant.rows[0],
    profile,
    missingFields: dossierMissingFields(profile),
    packages: packages.rows.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      priceCents: item.price_cents,
      durationMonths: item.duration_months,
      paymentPlan: item.payment_plan,
      rights: rights.rows.filter((right) => right.package_version_id === item.id).map((right) => ({
        name: right.name,
        description: right.description,
        quantity: right.quantity,
        scheduleText: right.schedule_text,
        channel: right.channel,
        location: right.location,
      })),
    })),
  };
}

export default async (request: Request, context: Context) => {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const pathname = new URL(request.url).pathname;
  const match = pathname.match(routes.pdf) ?? pathname.match(routes.dossier);
  const tenantId = match?.[1];
  if (!tenantId || !isUuid(tenantId)) return json({ error: "invalid_tenant" }, 422);

  if (request.method === "GET") {
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "packages:read")) return { state: "denied" as const };
        const data = await dossierData(client, tenantId);
        return data ? { state: "ready" as const, data } : { state: "not_found" as const };
      });
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "not_found") return json({ error: "tenant_not_found" }, 404);
      if (!routes.pdf.test(pathname)) return json({ dossier: result.data });
      if (result.data.missingFields.length) return json({ error: "dossier_profile_incomplete", missingFields: result.data.missingFields }, 409);
      if (!result.data.packages.length) return json({ error: "dossier_packages_required" }, 409);
      const pdfData: DossierPdfData = {
        organizationName: result.data.tenant.name,
        generatedAt: new Date().toISOString(),
        profile: {
          headline: result.data.profile.headline ?? "",
          seasonLabel: result.data.profile.seasonLabel,
          introduction: result.data.profile.introduction ?? "",
          clubPortrait: result.data.profile.clubPortrait ?? "",
          sponsorshipImpact: result.data.profile.sponsorshipImpact ?? "",
          audience: result.data.profile.audience,
          contactName: result.data.profile.contactName ?? "",
          contactEmail: result.data.profile.contactEmail ?? "",
          contactPhone: result.data.profile.contactPhone,
          website: result.data.profile.website,
        },
        packages: result.data.packages,
      };
      const bytes = await createDossierPdf(pdfData);
      return new Response(Buffer.from(bytes), {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="sponsoringdossier-${result.data.tenant.slug}.pdf"`,
          "Content-Type": "application/pdf",
        },
      });
    } catch (error) {
      console.error("dossier_load_failed", { requestId: context.requestId, tenantId, error });
      return json({ error: "dossier_load_failed", requestId: context.requestId }, 500);
    }
  }

  if (request.method !== "PATCH" || !routes.dossier.test(pathname)) return json({ error: "method_not_allowed" }, 405);
  try {
    verifyRequestOrigin(request);
  } catch (error) {
    return json({ error: "invalid_request_origin" }, (error as AuthError).status ?? 403);
  }
  const parsed = parseDossierProfile(await request.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, 422);

  try {
    const result = await withSession(user.id, tenantId, async (client) => {
      const role = await membershipRole(client, tenantId, user.id);
      if (!role || !hasPermission(role, "tenant:manage")) return { state: "denied" as const };
      const value = parsed.value;
      await client.query(`
        INSERT INTO tenant_sponsoring_profiles (
          tenant_id, headline, season_label, introduction, club_portrait, sponsorship_impact,
          audience, contact_name, contact_email, contact_phone, website, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (tenant_id) DO UPDATE SET
          headline = EXCLUDED.headline, season_label = EXCLUDED.season_label,
          introduction = EXCLUDED.introduction, club_portrait = EXCLUDED.club_portrait,
          sponsorship_impact = EXCLUDED.sponsorship_impact, audience = EXCLUDED.audience,
          contact_name = EXCLUDED.contact_name, contact_email = EXCLUDED.contact_email,
          contact_phone = EXCLUDED.contact_phone, website = EXCLUDED.website,
          updated_by = EXCLUDED.updated_by, updated_at = now()
      `, [tenantId, value.headline, value.seasonLabel, value.introduction, value.clubPortrait,
        value.sponsorshipImpact, value.audience, value.contactName, value.contactEmail,
        value.contactPhone, value.website, user.id]);
      await client.query(`
        INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
        VALUES ($1, $2, 'dossier.profile_updated', 'tenant_sponsoring_profile', $3::text,
                jsonb_build_object('complete', $4::boolean))
      `, [tenantId, user.id, tenantId, dossierMissingFields(value).length === 0]);
      return { state: "saved" as const, data: await dossierData(client, tenantId) };
    });
    if (result.state === "denied") return json({ error: "permission_denied" }, 403);
    return json({ dossier: result.data });
  } catch (error) {
    console.error("dossier_save_failed", { requestId: context.requestId, tenantId, error });
    return json({ error: "dossier_save_failed", requestId: context.requestId }, 500);
  }
};

export const config: Config = {
  path: ["/api/dossier/:tenantId", "/api/dossier/:tenantId/pdf"],
};
