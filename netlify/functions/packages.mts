import type { Config, Context } from "@netlify/functions";
import { AuthError, verifyRequestOrigin } from "@netlify/identity";
import { hasPermission, isResponse, json, requireUser, type MembershipRole } from "./_shared/auth.ts";
import { isUuid, withSession, type DatabaseClient } from "./_shared/database.ts";
import { getOrganizationProfile, mapOrganizationProfile } from "./_shared/organization-profile.ts";
import { parsePackageRightInput, parsePackageVersionInput, parseVersionCopyInput, type PackageRightInput, type PackageVersionInput } from "./_shared/package-input.ts";
import { parseOnlinePackageSetting } from "./_shared/sponsoring-checkout-input.ts";

type PackageStatus = "active" | "archived";
type VersionStatus = "draft" | "published" | "retired";

type PackageRow = {
  id: string;
  status: PackageStatus;
  created_at: string;
  updated_at: string;
};

type PackageListRow = PackageRow & {
  latest_version_id: string | null;
  latest_version_number: number | null;
  latest_name: string | null;
  latest_price_cents: number | null;
  latest_status: VersionStatus | null;
  latest_visibility: "private" | "public" | null;
  latest_capacity: number | null;
  reserved_quantity: string;
  version_count: string;
};

type VersionRow = {
  id: string;
  package_id: string;
  version_number: number;
  name: string;
  description: string | null;
  price_cents: number;
  duration_months: number;
  payment_plan: "annual" | "semiannual" | "quarterly" | "custom";
  payment_terms: string | null;
  valid_from: string | null;
  valid_until: string | null;
  visibility: "private" | "public";
  status: VersionStatus;
  capacity: number | null;
  deviation_approval_required: boolean;
  right_count: string;
  reserved_quantity: string;
  online_direct_enabled: boolean;
  online_direct_approved_at: string | null;
  created_at: string;
  updated_at: string;
};

type RightRow = {
  id: string;
  package_version_id: string;
  name: string;
  description: string | null;
  quantity: number;
  schedule_text: string | null;
  channel: string | null;
  location: string | null;
  responsible_role: string | null;
  exclusivity_scope: "none" | "industry" | "team" | "area" | "channel" | "period";
  exclusivity_key: string | null;
  created_at: string;
  updated_at: string;
};

const routes = {
  collection: /^\/api\/packages\/([0-9a-f-]+)$/i,
  package: /^\/api\/packages\/([0-9a-f-]+)\/([0-9a-f-]+)$/i,
  duplicate: /^\/api\/packages\/([0-9a-f-]+)\/([0-9a-f-]+)\/duplicate$/i,
  versions: /^\/api\/packages\/([0-9a-f-]+)\/([0-9a-f-]+)\/versions$/i,
  version: /^\/api\/packages\/([0-9a-f-]+)\/([0-9a-f-]+)\/versions\/([0-9a-f-]+)$/i,
  publish: /^\/api\/packages\/([0-9a-f-]+)\/([0-9a-f-]+)\/versions\/([0-9a-f-]+)\/publish$/i,
  online: /^\/api\/packages\/([0-9a-f-]+)\/([0-9a-f-]+)\/versions\/([0-9a-f-]+)\/online$/i,
  rights: /^\/api\/packages\/([0-9a-f-]+)\/([0-9a-f-]+)\/versions\/([0-9a-f-]+)\/rights$/i,
  right: /^\/api\/packages\/([0-9a-f-]+)\/([0-9a-f-]+)\/versions\/([0-9a-f-]+)\/rights\/([0-9a-f-]+)$/i,
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

const versionColumns = `
  version.id, version.package_id, version.version_number, version.name, version.description,
  version.price_cents, version.duration_months, version.payment_plan, version.payment_terms,
  version.valid_from::text, version.valid_until::text, version.visibility, version.status,
  version.capacity, version.deviation_approval_required,
  (SELECT count(*)::text FROM sponsorship_rights right_item
   WHERE right_item.tenant_id = version.tenant_id AND right_item.package_version_id = version.id) AS right_count,
  (SELECT COALESCE(sum(reservation.quantity), 0)::text FROM sponsorship_package_reservations reservation
   WHERE reservation.tenant_id = version.tenant_id AND reservation.package_version_id = version.id
     AND reservation.status IN ('held', 'confirmed')
     AND (reservation.status = 'confirmed' OR reservation.expires_at IS NULL OR reservation.expires_at > now())) AS reserved_quantity,
  COALESCE((SELECT online.is_enabled FROM sponsorship_package_online_settings online
    WHERE online.tenant_id = version.tenant_id AND online.package_version_id = version.id), false) AS online_direct_enabled,
  (SELECT online.approved_at::text FROM sponsorship_package_online_settings online
    WHERE online.tenant_id = version.tenant_id AND online.package_version_id = version.id) AS online_direct_approved_at,
  version.created_at::text, version.updated_at::text
`;

const rightReturningColumns = `
  id, package_version_id, name, description, quantity, schedule_text, channel, location,
  responsible_role, exclusivity_scope, exclusivity_key, created_at::text, updated_at::text
`;

async function packageDetail(client: DatabaseClient, tenantId: string, packageId: string) {
  const packageResult = await client.query<PackageRow>(`
    SELECT id, status, created_at::text, updated_at::text
    FROM sponsorship_packages WHERE tenant_id = $1 AND id = $2 LIMIT 1
  `, [tenantId, packageId]);
  const packageItem = packageResult.rows[0];
  if (!packageItem) return null;

  const versions = await client.query<VersionRow>(`
    SELECT ${versionColumns}
    FROM sponsorship_package_versions version
    WHERE version.tenant_id = $1 AND version.package_id = $2
    ORDER BY version.version_number DESC
  `, [tenantId, packageId]);
  const rights = await client.query<RightRow>(`
    SELECT ${rightReturningColumns}
    FROM sponsorship_rights
    WHERE tenant_id = $1 AND package_version_id IN (
      SELECT id FROM sponsorship_package_versions WHERE tenant_id = $1 AND package_id = $2
    )
    ORDER BY created_at, id
  `, [tenantId, packageId]);
  return { package: packageItem, versions: versions.rows, rights: rights.rows };
}

async function listPackages(client: DatabaseClient, tenantId: string) {
  const result = await client.query<PackageListRow>(`
    SELECT package.id, package.status, package.created_at::text, package.updated_at::text,
           latest.id AS latest_version_id, latest.version_number AS latest_version_number,
           latest.name AS latest_name, latest.price_cents AS latest_price_cents,
           latest.status AS latest_status, latest.visibility AS latest_visibility, latest.capacity AS latest_capacity,
           COALESCE((SELECT sum(reservation.quantity)::text
             FROM sponsorship_package_reservations reservation
             WHERE reservation.tenant_id = package.tenant_id AND reservation.package_version_id = latest.id
               AND reservation.status IN ('held', 'confirmed')
               AND (reservation.status = 'confirmed' OR reservation.expires_at IS NULL OR reservation.expires_at > now())), '0') AS reserved_quantity,
           (SELECT count(*)::text FROM sponsorship_package_versions counted
            WHERE counted.tenant_id = package.tenant_id AND counted.package_id = package.id) AS version_count
    FROM sponsorship_packages package
    LEFT JOIN LATERAL (
      SELECT version.id, version.version_number, version.name, version.price_cents, version.status, version.visibility, version.capacity
      FROM sponsorship_package_versions version
      WHERE version.tenant_id = package.tenant_id AND version.package_id = package.id
      ORDER BY (version.status = 'draft') DESC, version.version_number DESC
      LIMIT 1
    ) latest ON true
    WHERE package.tenant_id = $1
    ORDER BY lower(COALESCE(latest.name, '')), package.created_at
  `, [tenantId]);
  return result.rows;
}

async function publicCatalog(client: DatabaseClient, tenantId: string) {
  const versions = await client.query<VersionRow>(`
    SELECT ${versionColumns}
    FROM sponsorship_package_versions version
    JOIN sponsorship_packages package ON package.id = version.package_id AND package.tenant_id = version.tenant_id
    WHERE version.tenant_id = $1 AND version.status = 'published' AND version.visibility = 'public'
      AND package.status = 'active'
      AND (version.valid_from IS NULL OR version.valid_from <= CURRENT_DATE)
      AND (version.valid_until IS NULL OR version.valid_until >= CURRENT_DATE)
    ORDER BY version.price_cents, lower(version.name), version.version_number DESC
  `, [tenantId]);
  const rights = await client.query<RightRow>(`
    SELECT ${rightReturningColumns}
    FROM sponsorship_rights
    WHERE tenant_id = $1 AND package_version_id = ANY($2::uuid[])
    ORDER BY package_version_id, created_at, id
  `, [tenantId, versions.rows.map((version) => version.id)]);
  return versions.rows.map((version) => ({
    ...version,
    available_quantity: version.capacity === null ? null : Math.max(0, version.capacity - Number(version.reserved_quantity)),
    rights: rights.rows.filter((right) => right.package_version_id === version.id),
  }));
}

const versionValues = (input: PackageVersionInput) => [
  input.name, input.description, input.priceCents, input.durationMonths, input.paymentPlan,
  input.paymentTerms, input.validFrom, input.validUntil, input.visibility, input.capacity,
  input.deviationApprovalRequired,
];

const rightValues = (input: PackageRightInput) => [
  input.name, input.description, input.quantity, input.scheduleText, input.channel, input.location,
  input.responsibleRole, input.exclusivityScope, input.exclusivityKey,
];

export default async (request: Request, context: Context) => {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const pathname = new URL(request.url).pathname;
  const matches = {
    collection: pathname.match(routes.collection), package: pathname.match(routes.package),
    duplicate: pathname.match(routes.duplicate), versions: pathname.match(routes.versions), version: pathname.match(routes.version),
    publish: pathname.match(routes.publish), online: pathname.match(routes.online), rights: pathname.match(routes.rights), right: pathname.match(routes.right),
  };
  const matched = matches.collection ?? matches.package ?? matches.duplicate ?? matches.versions ?? matches.version ?? matches.publish ?? matches.online ?? matches.rights ?? matches.right;
  const tenantId = matched?.[1];
  const packageId = matched?.[2];
  const versionId = matches.version?.[3] ?? matches.publish?.[3] ?? matches.online?.[3] ?? matches.rights?.[3] ?? matches.right?.[3];
  const rightId = matches.right?.[4];
  if (!tenantId || !isUuid(tenantId)) return json({ error: "invalid_tenant" }, 422);
  if (packageId && !isUuid(packageId)) return json({ error: "invalid_package" }, 422);
  if (versionId && !isUuid(versionId)) return json({ error: "invalid_package_version" }, 422);
  if (rightId && !isUuid(rightId)) return json({ error: "invalid_package_right" }, 422);

  if (request.method === "GET") {
    if (!matches.collection && !matches.package) return json({ error: "method_not_allowed" }, 405);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "packages:read")) return { denied: true as const };
        return packageId
          ? { detail: await packageDetail(client, tenantId, packageId) }
          : { packages: await listPackages(client, tenantId), catalog: await publicCatalog(client, tenantId) };
      });
      if ("denied" in result) return json({ error: "permission_denied" }, 403);
      if ("detail" in result && !result.detail) return json({ error: "package_not_found" }, 404);
      return json(result);
    } catch (error) {
      console.error("packages_load_failed", { requestId: context.requestId, tenantId, packageId, error });
      return json({ error: "packages_load_failed", requestId: context.requestId }, 500);
    }
  }

  if (!["POST", "PATCH", "DELETE"].includes(request.method)) return json({ error: "method_not_allowed" }, 405);
  const invalidOrigin = verifyMutation(request);
  if (invalidOrigin) return invalidOrigin;
  const body = await request.json().catch(() => null);

  if (matches.collection && request.method === "POST") {
    const parsed = parsePackageVersionInput(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "packages:write")) return { state: "denied" as const };
        const createdPackage = await client.query<PackageRow>(`
          INSERT INTO sponsorship_packages (tenant_id, created_by)
          VALUES ($1, $2)
          RETURNING id, status, created_at::text, updated_at::text
        `, [tenantId, user.id]);
        const packageItem = createdPackage.rows[0];
        await client.query(`
          INSERT INTO sponsorship_package_versions (
            tenant_id, package_id, version_number, name, description, price_cents, duration_months,
            payment_plan, payment_terms, valid_from, valid_until, visibility, capacity,
            deviation_approval_required, created_by
          ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9::date, $10::date, $11, $12, $13, $14)
        `, [tenantId, packageItem.id, ...versionValues(parsed.value), user.id]);
        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'package.created', 'sponsorship_package', $3::text, jsonb_build_object('name', $4::text))
        `, [tenantId, user.id, packageItem.id, parsed.value.name]);
        return { state: "created" as const, detail: await packageDetail(client, tenantId, packageItem.id) };
      });
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      return json({ detail: result.detail }, 201);
    } catch (error) {
      console.error("package_create_failed", { requestId: context.requestId, tenantId, error });
      return json({ error: "package_create_failed", requestId: context.requestId }, 500);
    }
  }

  if (matches.duplicate && request.method === "POST" && packageId) {
    const parsed = parseVersionCopyInput(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "packages:write")) return { state: "denied" as const };
        const source = await client.query<{ id: string }>(`
          SELECT id FROM sponsorship_package_versions
          WHERE tenant_id = $1 AND package_id = $2 AND id = $3
          FOR SHARE
        `, [tenantId, packageId, parsed.value.sourceVersionId]);
        if (!source.rows[0]) return { state: "source_not_found" as const };
        const createdPackage = await client.query<{ id: string }>(`
          INSERT INTO sponsorship_packages (tenant_id, created_by)
          VALUES ($1, $2)
          RETURNING id
        `, [tenantId, user.id]);
        const newPackageId = createdPackage.rows[0].id;
        const createdVersion = await client.query<{ id: string; name: string }>(`
          INSERT INTO sponsorship_package_versions (
            tenant_id, package_id, version_number, name, description, price_cents, duration_months,
            payment_plan, payment_terms, valid_from, valid_until, visibility, capacity,
            deviation_approval_required, created_by
          )
          SELECT $1, $4, 1, left(source.name, 152) || ' – Kopie', source.description,
                 source.price_cents, source.duration_months, source.payment_plan, source.payment_terms,
                 source.valid_from, source.valid_until, 'private', source.capacity,
                 source.deviation_approval_required, $5
          FROM sponsorship_package_versions source
          WHERE source.tenant_id = $1 AND source.package_id = $2 AND source.id = $3
          RETURNING id, name
        `, [tenantId, packageId, parsed.value.sourceVersionId, newPackageId, user.id]);
        const newVersion = createdVersion.rows[0];
        if (!newVersion) return { state: "source_not_found" as const };
        await client.query(`
          INSERT INTO sponsorship_rights (
            tenant_id, package_version_id, name, description, quantity, schedule_text, channel,
            location, responsible_role, exclusivity_scope, exclusivity_key
          )
          SELECT tenant_id, $3, name, description, quantity, schedule_text, channel,
                 location, responsible_role, exclusivity_scope, exclusivity_key
          FROM sponsorship_rights WHERE tenant_id = $1 AND package_version_id = $2
        `, [tenantId, parsed.value.sourceVersionId, newVersion.id]);
        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'package.duplicated', 'sponsorship_package', $3::text,
                  jsonb_build_object('name', $4::text, 'source_package_id', $5::text, 'source_version_id', $6::text))
        `, [tenantId, user.id, newPackageId, newVersion.name, packageId, parsed.value.sourceVersionId]);
        return { state: "created" as const, detail: await packageDetail(client, tenantId, newPackageId) };
      });
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "source_not_found") return json({ error: "package_source_version_not_found" }, 404);
      return json({ detail: result.detail }, 201);
    } catch (error) {
      console.error("package_duplicate_failed", { requestId: context.requestId, tenantId, packageId, error });
      return json({ error: "package_duplicate_failed", requestId: context.requestId }, 500);
    }
  }

  if (matches.versions && request.method === "POST" && packageId) {
    const parsed = parseVersionCopyInput(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "packages:write")) return { state: "denied" as const };
        const existingDraft = await client.query<{ id: string }>(`
          SELECT id FROM sponsorship_package_versions
          WHERE tenant_id = $1 AND package_id = $2 AND status = 'draft' LIMIT 1
        `, [tenantId, packageId]);
        if (existingDraft.rows[0]) return { state: "draft_exists" as const };
        const created = await client.query<{ id: string }>(`
          INSERT INTO sponsorship_package_versions (
            tenant_id, package_id, version_number, name, description, price_cents, duration_months,
            payment_plan, payment_terms, valid_from, valid_until, visibility, capacity,
            deviation_approval_required, created_by
          )
          SELECT $1, $2,
                 (SELECT COALESCE(max(version_number), 0) + 1 FROM sponsorship_package_versions WHERE tenant_id = $1 AND package_id = $2),
                 source.name, source.description, source.price_cents, source.duration_months,
                 source.payment_plan, source.payment_terms, source.valid_from, source.valid_until, 'private',
                 source.capacity, source.deviation_approval_required, $4
          FROM sponsorship_package_versions source
          WHERE source.tenant_id = $1 AND source.package_id = $2 AND source.id = $3
          RETURNING id
        `, [tenantId, packageId, parsed.value.sourceVersionId, user.id]);
        const version = created.rows[0];
        if (!version) return { state: "source_not_found" as const };
        await client.query(`
          INSERT INTO sponsorship_rights (
            tenant_id, package_version_id, name, description, quantity, schedule_text, channel,
            location, responsible_role, exclusivity_scope, exclusivity_key
          )
          SELECT tenant_id, $3, name, description, quantity, schedule_text, channel,
                 location, responsible_role, exclusivity_scope, exclusivity_key
          FROM sponsorship_rights WHERE tenant_id = $1 AND package_version_id = $2
        `, [tenantId, parsed.value.sourceVersionId, version.id]);
        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'package.version_created', 'sponsorship_package_version', $3::text,
                  jsonb_build_object('source_version_id', $4::text))
        `, [tenantId, user.id, version.id, parsed.value.sourceVersionId]);
        return { state: "created" as const, detail: await packageDetail(client, tenantId, packageId) };
      });
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "draft_exists") return json({ error: "package_draft_exists" }, 409);
      if (result.state === "source_not_found") return json({ error: "package_source_version_not_found" }, 404);
      return json({ detail: result.detail }, 201);
    } catch (error) {
      console.error("package_version_create_failed", { requestId: context.requestId, tenantId, packageId, error });
      return json({ error: "package_version_create_failed", requestId: context.requestId }, 500);
    }
  }

  if (matches.version && request.method === "PATCH" && packageId && versionId) {
    const parsed = parsePackageVersionInput(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "packages:write")) return { state: "denied" as const };
        const updated = await client.query<{ id: string }>(`
          UPDATE sponsorship_package_versions version
          SET name = $4, description = $5, price_cents = $6, duration_months = $7,
              payment_plan = $8, payment_terms = $9, valid_from = $10::date, valid_until = $11::date,
              visibility = $12, capacity = $13, deviation_approval_required = $14, updated_at = now()
          WHERE version.tenant_id = $1 AND version.package_id = $2 AND version.id = $3 AND version.status = 'draft'
          RETURNING id
        `, [tenantId, packageId, versionId, ...versionValues(parsed.value)]);
        if (!updated.rows[0]) return { state: "locked" as const };
        await client.query("UPDATE sponsorship_packages SET updated_at = now() WHERE tenant_id = $1 AND id = $2", [tenantId, packageId]);
        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'package.version_updated', 'sponsorship_package_version', $3::text,
                  jsonb_build_object('name', $4::text, 'price_cents', $5::integer))
        `, [tenantId, user.id, versionId, parsed.value.name, parsed.value.priceCents]);
        return { state: "updated" as const, detail: await packageDetail(client, tenantId, packageId) };
      });
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "locked") return json({ error: "package_version_locked" }, 409);
      return json({ detail: result.detail });
    } catch (error) {
      console.error("package_version_update_failed", { requestId: context.requestId, tenantId, packageId, versionId, error });
      return json({ error: "package_version_update_failed", requestId: context.requestId }, 500);
    }
  }

  if (matches.publish && request.method === "POST" && packageId && versionId) {
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "packages:write")) return { state: "denied" as const };
        const rightCount = await client.query<{ count: string }>(`
          SELECT count(*)::text AS count FROM sponsorship_rights
          WHERE tenant_id = $1 AND package_version_id = $2
        `, [tenantId, versionId]);
        if (Number(rightCount.rows[0]?.count ?? 0) === 0) return { state: "rights_required" as const };
        const published = await client.query<{ id: string; name: string; version_number: number }>(`
          UPDATE sponsorship_package_versions
          SET status = 'published', updated_at = now()
          WHERE tenant_id = $1 AND package_id = $2 AND id = $3 AND status = 'draft'
          RETURNING id, name, version_number
        `, [tenantId, packageId, versionId]);
        if (!published.rows[0]) return { state: "locked" as const };
        await client.query("UPDATE sponsorship_packages SET updated_at = now() WHERE tenant_id = $1 AND id = $2", [tenantId, packageId]);
        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'package.version_published', 'sponsorship_package_version', $3::text,
                  jsonb_build_object('name', $4::text, 'version', $5::integer))
        `, [tenantId, user.id, versionId, published.rows[0].name, published.rows[0].version_number]);
        return { state: "published" as const, detail: await packageDetail(client, tenantId, packageId) };
      });
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "rights_required") return json({ error: "package_rights_required" }, 409);
      if (result.state === "locked") return json({ error: "package_version_locked" }, 409);
      return json({ detail: result.detail });
    } catch (error) {
      console.error("package_version_publish_failed", { requestId: context.requestId, tenantId, packageId, versionId, error });
      return json({ error: "package_version_publish_failed", requestId: context.requestId }, 500);
    }
  }

  if (matches.online && request.method === "PATCH" && packageId && versionId) {
    const parsed = parseOnlinePackageSetting(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "packages:write")) return { state: "denied" as const };
        const version = await client.query<{ name: string; status: VersionStatus; visibility: "private" | "public"; package_status: PackageStatus }>(`
          SELECT version.name, version.status, version.visibility, package.status AS package_status
          FROM sponsorship_package_versions version
          JOIN sponsorship_packages package ON package.tenant_id = version.tenant_id AND package.id = version.package_id
          WHERE version.tenant_id = $1 AND version.package_id = $2 AND version.id = $3 LIMIT 1
        `, [tenantId, packageId, versionId]);
        if (!version.rows[0]) return { state: "not_found" as const };
        if (parsed.value.enabled) {
          if (version.rows[0].status !== "published" || version.rows[0].visibility !== "public" || version.rows[0].package_status !== "active") {
            return { state: "not_public" as const };
          }
          const organization = mapOrganizationProfile(await getOrganizationProfile(client, tenantId));
          if (!organization?.contractComplete) return { state: "settings_incomplete" as const };
        }
        await client.query(`INSERT INTO sponsorship_package_online_settings
          (tenant_id, package_version_id, is_enabled, approved_by, approved_at, updated_by)
          VALUES ($1,$2,$3,CASE WHEN $3 THEN $4 ELSE NULL END,CASE WHEN $3 THEN now() ELSE NULL END,$4)
          ON CONFLICT (tenant_id, package_version_id) DO UPDATE SET
            is_enabled = EXCLUDED.is_enabled, approved_by = EXCLUDED.approved_by,
            approved_at = EXCLUDED.approved_at, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [tenantId, versionId, parsed.value.enabled, user.id]);
        await client.query(`INSERT INTO audit_events
          (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1,$2,$3,'sponsorship_package_version',$4,
            jsonb_build_object('name',$5::text,'acknowledged',$6::boolean))`,
        [tenantId, user.id, parsed.value.enabled ? "package.online_checkout_enabled" : "package.online_checkout_disabled",
          versionId, version.rows[0].name, parsed.value.acknowledged]);
        return { state: "saved" as const, detail: await packageDetail(client, tenantId, packageId) };
      }, user.email ?? undefined);
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "not_found") return json({ error: "package_version_not_found" }, 404);
      if (result.state === "not_public") return json({ error: "online_checkout_public_package_required" }, 409);
      if (result.state === "settings_incomplete") return json({ error: "contract_settings_incomplete" }, 409);
      return json({ detail: result.detail });
    } catch (error) {
      console.error("package_online_checkout_update_failed", { requestId: context.requestId, tenantId, packageId, versionId, error });
      return json({ error: "package_online_checkout_update_failed", requestId: context.requestId }, 500);
    }
  }

  if ((matches.rights && request.method === "POST" || matches.right && request.method === "PATCH") && packageId && versionId) {
    const parsed = parsePackageRightInput(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "packages:write")) return { state: "denied" as const };
        let right: RightRow | undefined;
        if (request.method === "POST") {
          const inserted = await client.query<RightRow>(`
            INSERT INTO sponsorship_rights (
              tenant_id, package_version_id, name, description, quantity, schedule_text, channel,
              location, responsible_role, exclusivity_scope, exclusivity_key
            )
            SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
            WHERE EXISTS (
              SELECT 1 FROM sponsorship_package_versions
              WHERE tenant_id = $1 AND package_id = $12 AND id = $2 AND status = 'draft'
            )
            RETURNING ${rightReturningColumns}
          `, [tenantId, versionId, ...rightValues(parsed.value), packageId]);
          right = inserted.rows[0];
        } else {
          const updated = await client.query<RightRow>(`
            UPDATE sponsorship_rights right_item
            SET name = $5, description = $6, quantity = $7, schedule_text = $8,
                channel = $9, location = $10, responsible_role = $11,
                exclusivity_scope = $12, exclusivity_key = $13, updated_at = now()
            WHERE right_item.tenant_id = $1 AND right_item.package_version_id = $2 AND right_item.id = $3
              AND EXISTS (
                SELECT 1 FROM sponsorship_package_versions
                WHERE tenant_id = $1 AND package_id = $4 AND id = $2 AND status = 'draft'
              )
            RETURNING ${rightReturningColumns}
          `, [tenantId, versionId, rightId, packageId, ...rightValues(parsed.value)]);
          right = updated.rows[0];
        }
        if (!right) return { state: "locked" as const };
        await client.query("UPDATE sponsorship_package_versions SET updated_at = now() WHERE tenant_id = $1 AND id = $2", [tenantId, versionId]);
        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, $3, 'sponsorship_right', $4::text,
                  jsonb_build_object('name', $5::text, 'exclusivity_scope', $6::text, 'exclusivity_key', $7::text))
        `, [tenantId, user.id, request.method === "POST" ? "package.right_created" : "package.right_updated", right.id, right.name, right.exclusivity_scope, right.exclusivity_key]);
        return { state: "saved" as const, detail: await packageDetail(client, tenantId, packageId) };
      });
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "locked") return json({ error: "package_version_locked" }, 409);
      return json({ detail: result.detail }, request.method === "POST" ? 201 : 200);
    } catch (error) {
      console.error("package_right_write_failed", { requestId: context.requestId, tenantId, packageId, versionId, rightId, error });
      return json({ error: "package_right_write_failed", requestId: context.requestId }, 500);
    }
  }

  if (matches.right && request.method === "DELETE" && packageId && versionId && rightId) {
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "packages:write")) return { state: "denied" as const };
        const candidate = await client.query<{ id: string; name: string; status: VersionStatus }>(`
          SELECT right_item.id, right_item.name, version.status
          FROM sponsorship_rights right_item
          JOIN sponsorship_package_versions version
            ON version.tenant_id = right_item.tenant_id AND version.id = right_item.package_version_id
          WHERE right_item.tenant_id = $1 AND right_item.package_version_id = $2 AND right_item.id = $3
            AND version.package_id = $4
          FOR UPDATE OF right_item, version
        `, [tenantId, versionId, rightId, packageId]);
        const right = candidate.rows[0];
        if (!right) return { state: "not_found" as const };
        if (right.status !== "draft") return { state: "locked" as const };
        const removed = await client.query<{ id: string }>(`
          DELETE FROM sponsorship_rights
          WHERE tenant_id = $1 AND package_version_id = $2 AND id = $3
          RETURNING id
        `, [tenantId, versionId, rightId]);
        if (!removed.rows[0]) return { state: "not_found" as const };
        await client.query("UPDATE sponsorship_package_versions SET updated_at = now() WHERE tenant_id = $1 AND id = $2", [tenantId, versionId]);
        await client.query("UPDATE sponsorship_packages SET updated_at = now() WHERE tenant_id = $1 AND id = $2", [tenantId, packageId]);
        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'package.right_deleted', 'sponsorship_right', $3::text,
                  jsonb_build_object('name', $4::text, 'package_version_id', $5::text))
        `, [tenantId, user.id, rightId, right.name, versionId]);
        return { state: "deleted" as const, detail: await packageDetail(client, tenantId, packageId) };
      });
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "not_found") return json({ error: "package_right_not_found" }, 404);
      if (result.state === "locked") return json({ error: "package_version_locked" }, 409);
      return json({ detail: result.detail });
    } catch (error) {
      console.error("package_right_delete_failed", { requestId: context.requestId, tenantId, packageId, versionId, rightId, error });
      return json({ error: "package_right_delete_failed", requestId: context.requestId }, 500);
    }
  }

  return json({ error: "route_not_found" }, 404);
};

export const config: Config = {
  path: [
    "/api/packages/:tenantId",
    "/api/packages/:tenantId/:packageId",
    "/api/packages/:tenantId/:packageId/duplicate",
    "/api/packages/:tenantId/:packageId/versions",
    "/api/packages/:tenantId/:packageId/versions/:versionId",
    "/api/packages/:tenantId/:packageId/versions/:versionId/publish",
    "/api/packages/:tenantId/:packageId/versions/:versionId/online",
    "/api/packages/:tenantId/:packageId/versions/:versionId/rights",
    "/api/packages/:tenantId/:packageId/versions/:versionId/rights/:rightId",
  ],
};
