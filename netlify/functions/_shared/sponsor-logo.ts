import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { AuthError, verifyRequestOrigin, type User } from "@netlify/identity";
import { hasPermission, json, type MembershipRole } from "./auth.ts";
import { isUuid, withSession, type DatabaseClient } from "./database.ts";
import { validateLogoUpload } from "./logo-upload.ts";

const BRAND_ASSET_STORE = "tenant-brand-assets";
export type LogoAudience = "sponsor" | "admin";

function verifyMutation(request: Request): Response | null {
  try { verifyRequestOrigin(request); return null; }
  catch (error) { return json({ error: "invalid_request_origin" }, (error as AuthError).status ?? 403); }
}

export async function sponsorLogoRecord(client: DatabaseClient, tenantId: string, sponsorId: string, userId: string, audience: LogoAudience, write = false, lock = false) {
  if (audience === "admin") {
    const membership = await client.query<{ role: MembershipRole }>(
      "SELECT role FROM tenant_memberships WHERE tenant_id = $1 AND identity_user_id = $2 LIMIT 1", [tenantId, userId]);
    const role = membership.rows[0]?.role;
    if (!role || !hasPermission(role, write ? "sponsors:write" : "sponsors:read")) return null;
  }
  const result = await client.query<{
    logo_blob_key: string | null;
    logo_content_type: "image/png" | "image/jpeg" | null;
    logo_updated_at: string | null;
  }>(`
    SELECT sponsor.logo_blob_key, sponsor.logo_content_type, sponsor.logo_updated_at::text
    FROM sponsors sponsor
    ${audience === "sponsor" ? `JOIN sponsor_portal_access access
      ON access.tenant_id = sponsor.tenant_id AND access.sponsor_id = sponsor.id` : ""}
    WHERE sponsor.tenant_id = $1 AND sponsor.id = $2
      ${audience === "sponsor" ? "AND access.identity_user_id = $3" : ""}
    LIMIT 1${lock ? " FOR UPDATE OF sponsor" : ""}
  `, audience === "sponsor" ? [tenantId, sponsorId, userId] : [tenantId, sponsorId]);
  return result.rows[0] ?? null;
}

export async function handleSponsorLogo(request: Request, context: Context, user: User, tenantId: string, sponsorId: string, audience: LogoAudience = "sponsor") {
  if (!isUuid(tenantId) || !isUuid(sponsorId)) return json({ error: "invalid_target" }, 422);

  if (request.method === "GET") {
    try {
      const row = await withSession(user.id, tenantId, (client) => sponsorLogoRecord(client, tenantId, sponsorId, user.id, audience, request.method !== "GET"), user.email ?? undefined);
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
        const current = await sponsorLogoRecord(client, tenantId, sponsorId, user.id, audience, true, true);
        if (!current) return { state: "denied" as const };
        if (!current.logo_blob_key) return { state: "not_found" as const };
        await client.query(`UPDATE sponsors
          SET logo_blob_key = NULL, logo_content_type = NULL, logo_updated_at = NULL, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`, [tenantId, sponsorId]);
        await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1,$2,'sponsor.logo_deleted','sponsor',$3::text,jsonb_build_object('source',$4::text))`, [tenantId, user.id, sponsorId, audience]);
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
      await sponsorLogoRecord(client, tenantId, sponsorId, user.id, audience, request.method !== "GET"),
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
      const current = await sponsorLogoRecord(client, tenantId, sponsorId, user.id, audience, true, true);
      if (!current) return { state: "denied" as const };
      const updated = await client.query<{ logo_updated_at: string }>(`UPDATE sponsors
        SET logo_blob_key = $3, logo_content_type = $4, logo_updated_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING logo_updated_at::text`, [tenantId, sponsorId, newKey, validated.value.contentType]);
      await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
        VALUES ($1,$2,'sponsor.logo_updated','sponsor',$3::text,
          jsonb_build_object('content_type',$4::text,'size_bytes',$5::integer,'source',$6::text))`,
      [tenantId, user.id, sponsorId, validated.value.contentType, validated.value.size, audience]);
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

