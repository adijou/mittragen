import type { Config, Context } from "@netlify/functions";
import { AuthError, verifyRequestOrigin } from "@netlify/identity";
import { hasPermission, isResponse, json, requireUser, type MembershipRole } from "./_shared/auth.ts";
import { isUuid, withSession, type DatabaseClient } from "./_shared/database.ts";
import { mapImportRow, parseImportBatchInput, parseImportMappingInput, type ImportMapping, type ImportRawRow } from "./_shared/import-input.ts";

type ImportStatus = "draft" | "mapped" | "imported";
type BatchRow = {
  id: string;
  tenant_id: string;
  name: string;
  source_filename: string;
  status: ImportStatus;
  source_columns: string[];
  mapping: ImportMapping;
  row_count: number;
  valid_count: number;
  error_count: number;
  imported_count: number;
  created_at: string;
  updated_at: string;
  imported_at: string | null;
};
type ImportRow = {
  row_number: number;
  raw_data: ImportRawRow;
  mapped_data: Record<string, unknown>;
  validation_errors: string[];
  status: "pending" | "valid" | "invalid" | "imported";
};

const batchColumns = `
  id, tenant_id, name, source_filename, status, source_columns, mapping,
  row_count, valid_count, error_count, imported_count,
  created_at::text, updated_at::text, imported_at::text
`;

const routes = {
  collection: /^\/api\/imports\/([0-9a-f-]+)$/i,
  batch: /^\/api\/imports\/([0-9a-f-]+)\/([0-9a-f-]+)$/i,
  commit: /^\/api\/imports\/([0-9a-f-]+)\/([0-9a-f-]+)\/commit$/i,
};

function verifyMutation(request: Request): Response | null {
  try {
    verifyRequestOrigin(request);
    return null;
  } catch (error) {
    return json({ error: "invalid_request_origin" }, (error as AuthError).status ?? 403);
  }
}

async function canImport(client: DatabaseClient, tenantId: string, userId: string) {
  const membership = await client.query<{ role: MembershipRole }>(`
    SELECT role FROM tenant_memberships
    WHERE tenant_id = $1 AND identity_user_id = $2
    LIMIT 1
  `, [tenantId, userId]);
  return Boolean(membership.rows[0] && hasPermission(membership.rows[0].role, "sponsors:write"));
}

async function batchDetail(client: DatabaseClient, tenantId: string, batchId: string) {
  const batch = await client.query<BatchRow>(`
    SELECT ${batchColumns}
    FROM sponsor_import_batches
    WHERE tenant_id = $1 AND id = $2
    LIMIT 1
  `, [tenantId, batchId]);
  if (!batch.rows[0]) return null;
  const rows = await client.query<ImportRow>(`
    SELECT row_number, raw_data, mapped_data, validation_errors, status
    FROM sponsor_import_rows
    WHERE tenant_id = $1 AND batch_id = $2
    ORDER BY row_number
    LIMIT 50
  `, [tenantId, batchId]);
  return { batch: batch.rows[0], rows: rows.rows };
}

export default async (request: Request, context: Context) => {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const pathname = new URL(request.url).pathname;
  const collectionMatch = pathname.match(routes.collection);
  const batchMatch = pathname.match(routes.batch);
  const commitMatch = pathname.match(routes.commit);
  const tenantId = collectionMatch?.[1] ?? batchMatch?.[1] ?? commitMatch?.[1];
  const batchId = batchMatch?.[2] ?? commitMatch?.[2];
  if (!tenantId || !isUuid(tenantId)) return json({ error: "invalid_tenant" }, 422);
  if (batchId && !isUuid(batchId)) return json({ error: "invalid_import" }, 422);

  if (request.method === "GET") {
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        if (!await canImport(client, tenantId, user.id)) return { denied: true as const };
        if (batchId) return { detail: await batchDetail(client, tenantId, batchId) };
        const batches = await client.query<BatchRow>(`
          SELECT ${batchColumns}
          FROM sponsor_import_batches
          WHERE tenant_id = $1
          ORDER BY created_at DESC
        `, [tenantId]);
        return { batches: batches.rows };
      });
      if ("denied" in result) return json({ error: "permission_denied" }, 403);
      if ("detail" in result && !result.detail) return json({ error: "import_not_found" }, 404);
      return json(result.detail ?? { batches: result.batches });
    } catch (error) {
      console.error("imports_load_failed", { requestId: context.requestId, tenantId, batchId, error });
      return json({ error: "imports_load_failed", requestId: context.requestId }, 500);
    }
  }

  if (!['POST', 'PATCH'].includes(request.method)) return json({ error: "method_not_allowed" }, 405);
  const invalidOrigin = verifyMutation(request);
  if (invalidOrigin) return invalidOrigin;

  if (collectionMatch && request.method === "POST") {
    const parsed = parseImportBatchInput(await request.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        if (!await canImport(client, tenantId, user.id)) return { denied: true as const };
        const created = await client.query<BatchRow>(`
          INSERT INTO sponsor_import_batches (tenant_id, name, source_filename, source_columns, row_count, created_by)
          VALUES ($1, $2, $3, $4::jsonb, $5, $6)
          RETURNING ${batchColumns}
        `, [tenantId, parsed.value.name, parsed.value.sourceFilename, JSON.stringify(parsed.value.sourceColumns), parsed.value.rows.length, user.id]);
        const batch = created.rows[0];
        await client.query(`
          INSERT INTO sponsor_import_rows (tenant_id, batch_id, row_number, raw_data)
          SELECT $1, $2, source.ordinality::integer, source.value
          FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS source(value, ordinality)
        `, [tenantId, batch.id, JSON.stringify(parsed.value.rows)]);
        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'import.created', 'sponsor_import', $3::text, jsonb_build_object('rows', $4::integer, 'filename', $5::text))
        `, [tenantId, user.id, batch.id, parsed.value.rows.length, parsed.value.sourceFilename]);
        return { detail: await batchDetail(client, tenantId, batch.id) };
      });
      if ("denied" in result) return json({ error: "permission_denied" }, 403);
      return json(result.detail, 201);
    } catch (error) {
      console.error("import_create_failed", { requestId: context.requestId, tenantId, error });
      return json({ error: "import_create_failed", requestId: context.requestId }, 500);
    }
  }

  if (batchMatch && request.method === "PATCH" && batchId) {
    const body = await request.json().catch(() => null);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        if (!await canImport(client, tenantId, user.id)) return { state: "denied" as const };
        const current = await client.query<BatchRow>(`
          SELECT ${batchColumns} FROM sponsor_import_batches
          WHERE tenant_id = $1 AND id = $2
          FOR UPDATE
        `, [tenantId, batchId]);
        const batch = current.rows[0];
        if (!batch) return { state: "not_found" as const };
        if (batch.status === "imported") return { state: "already_imported" as const };
        const parsed = parseImportMappingInput(body, batch.source_columns);
        if (!parsed.ok) return { state: "invalid" as const, error: parsed.error };

        const sourceRows = await client.query<{ row_number: number; raw_data: ImportRawRow }>(`
          SELECT row_number, raw_data FROM sponsor_import_rows
          WHERE tenant_id = $1 AND batch_id = $2
          ORDER BY row_number
        `, [tenantId, batchId]);
        const validated = sourceRows.rows.map((row) => {
          const validation = mapImportRow(row.raw_data, parsed.value);
          return {
            row_number: row.row_number,
            mapped_data: validation.mappedData,
            validation_errors: validation.errors,
            status: validation.errors.length ? "invalid" : "valid",
          };
        });
        const errorCount = validated.filter((row) => row.status === "invalid").length;
        const validCount = validated.length - errorCount;

        await client.query(`
          UPDATE sponsor_import_rows AS target
          SET mapped_data = source.mapped_data,
              validation_errors = source.validation_errors,
              status = source.status
          FROM jsonb_to_recordset($3::jsonb) AS source(
            row_number integer,
            mapped_data jsonb,
            validation_errors jsonb,
            status text
          )
          WHERE target.tenant_id = $1 AND target.batch_id = $2 AND target.row_number = source.row_number
        `, [tenantId, batchId, JSON.stringify(validated)]);
        await client.query(`
          UPDATE sponsor_import_batches
          SET mapping = $3::jsonb, status = 'mapped', valid_count = $4, error_count = $5, updated_at = now()
          WHERE tenant_id = $1 AND id = $2
        `, [tenantId, batchId, JSON.stringify(parsed.value), validCount, errorCount]);
        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'import.validated', 'sponsor_import', $3::text, jsonb_build_object('valid', $4::integer, 'errors', $5::integer))
        `, [tenantId, user.id, batchId, validCount, errorCount]);
        return { state: "mapped" as const, detail: await batchDetail(client, tenantId, batchId) };
      });
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "not_found") return json({ error: "import_not_found" }, 404);
      if (result.state === "already_imported") return json({ error: "import_already_completed" }, 409);
      if (result.state === "invalid") return json({ error: result.error }, 422);
      return json(result.detail);
    } catch (error) {
      console.error("import_mapping_failed", { requestId: context.requestId, tenantId, batchId, error });
      return json({ error: "import_mapping_failed", requestId: context.requestId }, 500);
    }
  }

  if (commitMatch && request.method === "POST" && batchId) {
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        if (!await canImport(client, tenantId, user.id)) return { state: "denied" as const };
        const current = await client.query<BatchRow>(`
          SELECT ${batchColumns} FROM sponsor_import_batches
          WHERE tenant_id = $1 AND id = $2
          FOR UPDATE
        `, [tenantId, batchId]);
        const batch = current.rows[0];
        if (!batch) return { state: "not_found" as const };
        if (batch.status === "imported") return { state: "imported" as const, importedCount: batch.imported_count };
        if (batch.status !== "mapped" || batch.error_count > 0 || batch.valid_count !== batch.row_count) return { state: "not_ready" as const };

        const inserted = await client.query<{ count: string }>(`
          WITH prepared AS (
            SELECT id AS import_row_id, gen_random_uuid() AS sponsor_id, tenant_id, mapped_data
            FROM sponsor_import_rows
            WHERE tenant_id = $1 AND batch_id = $2 AND status = 'valid'
          ), inserted_sponsors AS (
            INSERT INTO sponsors (
              id, tenant_id, legal_name, contact_name, contact_email, phone, street, postal_code, city, website,
              source_organization, status, proposal_package, annual_value_cents, notes
            )
            SELECT sponsor_id, tenant_id, mapped_data->>'legal_name', NULLIF(mapped_data->>'contact_name', ''),
                   NULLIF(mapped_data->>'contact_email', ''), NULLIF(mapped_data->>'phone', ''), NULLIF(mapped_data->>'street', ''),
                   NULLIF(mapped_data->>'postal_code', ''), NULLIF(mapped_data->>'city', ''), NULLIF(mapped_data->>'website', ''),
                   NULLIF(mapped_data->>'source_organization', ''), COALESCE(mapped_data->>'status', 'draft'),
                   NULLIF(mapped_data->>'proposal_package', ''), COALESCE((mapped_data->>'annual_value_cents')::integer, 0),
                   NULLIF(mapped_data->>'notes', '')
            FROM prepared
            RETURNING id
          ), updated_rows AS (
            UPDATE sponsor_import_rows AS target
            SET sponsor_id = prepared.sponsor_id, status = 'imported'
            FROM prepared
            WHERE target.id = prepared.import_row_id
              AND EXISTS (SELECT 1 FROM inserted_sponsors WHERE inserted_sponsors.id = prepared.sponsor_id)
            RETURNING target.id
          )
          SELECT count(*)::text AS count FROM updated_rows
        `, [tenantId, batchId]);
        const importedCount = Number(inserted.rows[0]?.count ?? 0);
        await client.query(`
          UPDATE sponsor_import_batches
          SET status = 'imported', imported_count = $3, imported_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND id = $2
        `, [tenantId, batchId, importedCount]);
        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'import.completed', 'sponsor_import', $3::text, jsonb_build_object('imported', $4::integer))
        `, [tenantId, user.id, batchId, importedCount]);
        return { state: "imported" as const, importedCount };
      });
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "not_found") return json({ error: "import_not_found" }, 404);
      if (result.state === "not_ready") return json({ error: "import_not_ready" }, 409);
      return json({ importedCount: result.importedCount });
    } catch (error) {
      console.error("import_commit_failed", { requestId: context.requestId, tenantId, batchId, error });
      return json({ error: "import_commit_failed", requestId: context.requestId }, 500);
    }
  }

  return json({ error: "route_not_found" }, 404);
};

export const config: Config = {
  path: [
    "/api/imports/:tenantId",
    "/api/imports/:tenantId/:batchId",
    "/api/imports/:tenantId/:batchId/commit",
  ],
};
