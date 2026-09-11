import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { AuthError, verifyRequestOrigin } from "@netlify/identity";
import { PDFDocument } from "pdf-lib";
import { hasPermission, isResponse, json, requireUser, type MembershipRole } from "./_shared/auth.ts";
import { isUuid, withSession, type DatabaseClient } from "./_shared/database.ts";
import { isLogoUpload, parseBrandColors, parseOrganizationProfile } from "./_shared/organization-profile-input.ts";
import { getOrganizationProfile, mapOrganizationProfile } from "./_shared/organization-profile.ts";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const STORE_NAME = "tenant-brand-assets";
const routes = {
  profile: /^\/api\/organization\/([0-9a-f-]+)$/i,
  logo: /^\/api\/organization\/([0-9a-f-]+)\/logo$/i,
};

async function membershipRole(client: DatabaseClient, tenantId: string, userId: string) {
  const result = await client.query<{ role: MembershipRole }>(`
    SELECT role FROM tenant_memberships
    WHERE tenant_id = $1 AND identity_user_id = $2 LIMIT 1
  `, [tenantId, userId]);
  return result.rows[0]?.role ?? null;
}

function verifyMutation(request: Request) {
  try {
    verifyRequestOrigin(request);
    return null;
  } catch (error) {
    return json({ error: "invalid_request_origin" }, (error as AuthError).status ?? 403);
  }
}

function detectedContentType(bytes: Uint8Array) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png" as const;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg" as const;
  return null;
}

function imageDimensions(bytes: Uint8Array, contentType: "image/png" | "image/jpeg") {
  if (contentType === "image/png") {
    if (bytes.length < 24) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  let offset = 2;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 8 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if (startOfFrame.has(marker) && length >= 7) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += length;
  }
  return null;
}

async function saveProfile(client: DatabaseClient, tenantId: string, userId: string, value: ReturnType<typeof parseOrganizationProfile> & { ok: true }) {
  const input = value.value;
  await client.query(`
    INSERT INTO tenant_contract_settings (
      tenant_id, legal_name, street, postal_code, city, country, representative_name,
      representative_title, contact_name, contact_email, contact_phone, website,
      renewal_mode, notice_months, place_of_jurisdiction, brand_primary_color,
      brand_accent_color, updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    ON CONFLICT (tenant_id) DO UPDATE SET
      legal_name = EXCLUDED.legal_name, street = EXCLUDED.street, postal_code = EXCLUDED.postal_code,
      city = EXCLUDED.city, country = EXCLUDED.country, representative_name = EXCLUDED.representative_name,
      representative_title = EXCLUDED.representative_title, contact_name = EXCLUDED.contact_name,
      contact_email = EXCLUDED.contact_email, contact_phone = EXCLUDED.contact_phone,
      website = EXCLUDED.website, renewal_mode = EXCLUDED.renewal_mode,
      notice_months = EXCLUDED.notice_months, place_of_jurisdiction = EXCLUDED.place_of_jurisdiction,
      brand_primary_color = EXCLUDED.brand_primary_color, brand_accent_color = EXCLUDED.brand_accent_color,
      updated_by = EXCLUDED.updated_by, updated_at = now()
  `, [tenantId, input.legalName, input.street, input.postalCode, input.city, input.country,
    input.representativeName, input.representativeTitle, input.contactName, input.contactEmail,
    input.contactPhone, input.website, input.renewalMode, input.noticeMonths,
    input.placeOfJurisdiction, input.brandPrimaryColor, input.brandAccentColor, userId]);
  await client.query(`
    INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
    VALUES ($1,$2,'organization.profile_updated','tenant',$1::text,
            jsonb_build_object('renewal_mode',$3::text,'brand_primary',$4::text,'brand_accent',$5::text))
  `, [tenantId, userId, input.renewalMode, input.brandPrimaryColor, input.brandAccentColor]);
}

export default async (request: Request, context: Context) => {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const pathname = new URL(request.url).pathname;
  const match = pathname.match(routes.logo) ?? pathname.match(routes.profile);
  const tenantId = match?.[1];
  if (!tenantId || !isUuid(tenantId)) return json({ error: "invalid_tenant" }, 422);

  if (request.method === "GET") {
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "packages:read")) return { state: "denied" as const };
        const row = await getOrganizationProfile(client, tenantId);
        return row ? { state: "ready" as const, row } : { state: "not_found" as const };
      });
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "not_found") return json({ error: "tenant_not_found" }, 404);
      if (!routes.logo.test(pathname)) return json({ organization: mapOrganizationProfile(result.row) });
      if (!result.row.logo_blob_key || !result.row.logo_content_type) return json({ error: "logo_not_found" }, 404);
      const data = await getStore({ name: STORE_NAME, consistency: "strong" }).get(result.row.logo_blob_key, { type: "arrayBuffer" }) as ArrayBuffer | null;
      if (!data) return json({ error: "logo_not_found" }, 404);
      return new Response(data, { headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Type": result.row.logo_content_type,
        "X-Content-Type-Options": "nosniff",
      } });
    } catch (error) {
      console.error("organization_load_failed", { requestId: context.requestId, tenantId, error });
      return json({ error: "organization_load_failed", requestId: context.requestId }, 500);
    }
  }

  if (request.method !== "PATCH" && request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const invalidOrigin = verifyMutation(request);
  if (invalidOrigin) return invalidOrigin;

  if (routes.profile.test(pathname) && request.method === "PATCH") {
    const parsed = parseOrganizationProfile(await request.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "tenant:manage")) return { state: "denied" as const };
        await saveProfile(client, tenantId, user.id, parsed);
        return { state: "saved" as const, row: await getOrganizationProfile(client, tenantId) };
      });
      return result.state === "denied"
        ? json({ error: "permission_denied" }, 403)
        : json({ organization: mapOrganizationProfile(result.row) });
    } catch (error) {
      console.error("organization_save_failed", { requestId: context.requestId, tenantId, error });
      return json({ error: "organization_save_failed", requestId: context.requestId }, 500);
    }
  }

  if (!routes.logo.test(pathname) || request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const form = await request.formData().catch(() => null);
  const logo = form?.get("logo");
  if (!isLogoUpload(logo) || logo.size === 0 || logo.size > MAX_LOGO_BYTES) return json({ error: "invalid_logo_size" }, 422);
  const colors = parseBrandColors(form?.get("brandPrimaryColor"), form?.get("brandAccentColor"));
  if (!colors.ok) return json({ error: colors.error }, 422);
  const buffer = await logo.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const contentType = detectedContentType(bytes);
  if (!contentType) return json({ error: "invalid_logo_type" }, 422);
  const dimensions = imageDimensions(bytes, contentType);
  if (!dimensions || dimensions.width < 16 || dimensions.height < 16 || dimensions.width > 6000 || dimensions.height > 6000
    || dimensions.width * dimensions.height > 30_000_000) return json({ error: "invalid_logo_dimensions" }, 422);
  try {
    const probe = await PDFDocument.create();
    if (contentType === "image/png") await probe.embedPng(bytes);
    else await probe.embedJpg(bytes);
  } catch {
    return json({ error: "invalid_logo_file" }, 422);
  }

  let newKey = "";
  let oldKey: string | null = null;
  let saveStage: "access" | "blob" | "database" = "access";
  try {
    const access = await withSession(user.id, tenantId, async (client) => {
      const role = await membershipRole(client, tenantId, user.id);
      if (!role || !hasPermission(role, "tenant:manage")) return { state: "denied" as const };
      const row = await getOrganizationProfile(client, tenantId);
      return { state: "allowed" as const, oldKey: row?.logo_blob_key ?? null };
    });
    if (access.state === "denied") return json({ error: "permission_denied" }, 403);
    oldKey = access.oldKey;
    newKey = `tenant-logos/${tenantId}/${crypto.randomUUID()}`;
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    saveStage = "blob";
    await store.set(newKey, buffer, { metadata: { contentType, uploadedAt: new Date().toISOString() } });
    saveStage = "database";
    const result = await withSession(user.id, tenantId, async (client) => {
      const role = await membershipRole(client, tenantId, user.id);
      if (!role || !hasPermission(role, "tenant:manage")) return { state: "denied" as const };
      await client.query(`
        INSERT INTO tenant_contract_settings (
          tenant_id, logo_blob_key, logo_content_type, logo_updated_at,
          brand_primary_color, brand_accent_color, updated_by
        ) VALUES ($1,$2,$3,now(),$4,$5,$6)
        ON CONFLICT (tenant_id) DO UPDATE SET
          logo_blob_key = EXCLUDED.logo_blob_key, logo_content_type = EXCLUDED.logo_content_type,
          logo_updated_at = now(), brand_primary_color = EXCLUDED.brand_primary_color,
          brand_accent_color = EXCLUDED.brand_accent_color,
          updated_by = EXCLUDED.updated_by, updated_at = now()
      `, [tenantId, newKey, contentType, colors.value.brandPrimaryColor, colors.value.brandAccentColor, user.id]);
      await client.query(`
        INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
        VALUES ($1,$2,'organization.logo_updated','tenant',$1::text,
                jsonb_build_object('content_type',$3::text,'size_bytes',$4::integer))
      `, [tenantId, user.id, contentType, logo.size]);
      return { state: "saved" as const, row: await getOrganizationProfile(client, tenantId) };
    });
    if (result.state === "denied") {
      await store.delete(newKey).catch(() => undefined);
      return json({ error: "permission_denied" }, 403);
    }
    if (oldKey && oldKey !== newKey) {
      try { await store.delete(oldKey); }
      catch (error) { console.error("organization_old_logo_cleanup_failed", { tenantId, error }); }
    }
    return json({ organization: mapOrganizationProfile(result.row) });
  } catch (error) {
    if (newKey) await getStore({ name: STORE_NAME, consistency: "strong" }).delete(newKey).catch(() => undefined);
    const code = saveStage === "blob" ? "organization_logo_storage_failed"
      : saveStage === "database" ? "organization_logo_metadata_failed"
      : "organization_logo_access_failed";
    console.error(code, { requestId: context.requestId, tenantId, error });
    return json({ error: code, requestId: context.requestId }, saveStage === "blob" ? 503 : 500);
  }
};

export const config: Config = {
  path: ["/api/organization/:tenantId", "/api/organization/:tenantId/logo"],
};
