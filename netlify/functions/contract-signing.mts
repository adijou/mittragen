import { createHash } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import { AuthError, verifyRequestOrigin } from "@netlify/identity";
import { json } from "./_shared/auth.ts";
import { withSession, type DatabaseClient } from "./_shared/database.ts";
import { parseContractAcknowledgement } from "./_shared/contract-input.ts";
import { createContractPdf, type ContractPdfData } from "./_shared/contract-pdf.ts";

const route = /^\/api\/contract-signing\/([A-Za-z0-9_-]{43})(?:\/(pdf|confirm))?$/;

type SigningRow = {
  id: string;
  tenant_id: string;
  contract_id: string;
  sponsor_id: string;
  signer_email: string;
  signer_name: string;
  signer_role: string;
  delivery_mode: "account" | "one_time";
  status: "pending" | "sent" | "opened" | "confirmed" | "failed" | "revoked";
  expires_at: string;
  opened_at: string | null;
  confirmed_at: string | null;
};

type PublicContract = {
  id: string;
  contract_number: string;
  version_number: number;
  title: string;
  status: "released" | "confirmed";
  signing_method: "click" | "advanced" | "qualified";
  snapshot_hash: string;
  organization_snapshot: ContractPdfData["organization"];
  sponsor_snapshot: ContractPdfData["sponsor"];
  package_snapshot: ContractPdfData["package"];
  terms_snapshot: ContractPdfData["terms"];
  special_agreements: string;
  created_at: string;
  released_at: string;
  confirmed_at: string | null;
  confirmed_email: string | null;
  confirmed_name: string | null;
  confirmed_role: string | null;
};

function verifyMutation(request: Request): Response | null {
  try {
    verifyRequestOrigin(request);
    return null;
  } catch (error) {
    return json({ error: "invalid_request_origin" }, (error as AuthError).status ?? 403);
  }
}

async function loadSigning(client: DatabaseClient, tokenHash: string, lock = false) {
  await client.query("SELECT set_config('app.contract_signing_token_hash', $1, true)", [tokenHash]);
  const signing = await client.query<SigningRow>(`
    SELECT id, tenant_id, contract_id, sponsor_id, signer_email, signer_name, signer_role,
           delivery_mode, status, expires_at::text, opened_at::text, confirmed_at::text
    FROM contract_signing_requests
    WHERE token_hash = $1
    LIMIT 1${lock ? " FOR UPDATE" : ""}
  `, [tokenHash]);
  const row = signing.rows[0];
  if (!row) return null;
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [row.tenant_id]);
  return row;
}

async function loadContract(client: DatabaseClient, signing: SigningRow) {
  const result = await client.query<PublicContract>(`
    SELECT id, contract_number, version_number, title, status, signing_method, snapshot_hash,
           organization_snapshot, sponsor_snapshot, package_snapshot, terms_snapshot,
           special_agreements, created_at::text, released_at::text, confirmed_at::text,
           confirmed_email, confirmed_name, confirmed_role
    FROM sponsorship_contracts
    WHERE tenant_id = $1 AND id = $2 AND sponsor_id = $3 AND status IN ('released', 'confirmed')
    LIMIT 1
  `, [signing.tenant_id, signing.contract_id, signing.sponsor_id]);
  return result.rows[0] ?? null;
}

function validity(signing: SigningRow) {
  if (signing.delivery_mode !== "one_time" || ["pending", "failed", "revoked"].includes(signing.status)) return "invalid" as const;
  if (new Date(signing.expires_at).getTime() <= Date.now()) return "expired" as const;
  return "valid" as const;
}

function pdfData(contract: PublicContract): ContractPdfData {
  return {
    contractNumber: contract.contract_number,
    versionNumber: contract.version_number,
    title: contract.title,
    status: contract.status,
    createdAt: contract.created_at,
    releasedAt: contract.released_at,
    confirmedAt: contract.confirmed_at,
    confirmedEmail: contract.confirmed_email,
    snapshotHash: contract.snapshot_hash,
    organization: contract.organization_snapshot,
    sponsor: contract.sponsor_snapshot,
    package: contract.package_snapshot,
    terms: contract.terms_snapshot,
    specialAgreements: contract.special_agreements,
    signingAuthorityName: contract.confirmed_name,
    signingAuthorityRole: contract.confirmed_role,
  };
}

export default async (request: Request, context: Context) => {
  const pathname = new URL(request.url).pathname;
  const match = route.exec(pathname);
  if (!match) return json({ error: "route_not_found" }, 404);
  const rawToken = match[1];
  const action = match[2] ?? "detail";
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  if ((action === "detail" || action === "pdf") && request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (action === "confirm" && request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (action === "confirm") {
    const invalidOrigin = verifyMutation(request);
    if (invalidOrigin) return invalidOrigin;
    const parsed = parseContractAcknowledgement(await request.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, 422);
  }

  try {
    const result = await withSession("contract-one-time-link", null, async (client) => {
      const signing = await loadSigning(client, tokenHash, action === "confirm");
      if (!signing) return { state: "not_found" as const };
      const state = validity(signing);
      if (state !== "valid") return { state };
      const contract = await loadContract(client, signing);
      if (!contract) return { state: "not_found" as const };

      if (action === "detail") {
        if (signing.status === "sent") {
          await client.query(`UPDATE contract_signing_requests SET status = 'opened', opened_at = now(), updated_at = now()
            WHERE id = $1 AND status = 'sent'`, [signing.id]);
          await client.query(`INSERT INTO sponsorship_contract_events
            (tenant_id, contract_id, event_type, actor_user_id, actor_email, evidence)
            VALUES ($1,$2,'viewed',$3,$4,jsonb_build_object('confirmation_mode','one_time_link','snapshot_hash',$5::text))`,
          [signing.tenant_id, signing.contract_id, `one-time:${signing.id}`, signing.signer_email, contract.snapshot_hash]);
          signing.status = "opened";
          signing.opened_at = new Date().toISOString();
        }
        return { state: "ready" as const, signing, contract };
      }

      if (action === "pdf") {
        const bytes = await createContractPdf(pdfData(contract));
        await client.query(`INSERT INTO sponsorship_contract_events
          (tenant_id, contract_id, event_type, actor_user_id, actor_email, evidence)
          VALUES ($1,$2,'downloaded',$3,$4,jsonb_build_object('confirmation_mode','one_time_link','snapshot_hash',$5::text))`,
        [signing.tenant_id, signing.contract_id, `one-time:${signing.id}`, signing.signer_email, contract.snapshot_hash]);
        return { state: "pdf" as const, bytes, number: contract.contract_number };
      }

      if (signing.status === "confirmed" || contract.status === "confirmed") return { state: "already_confirmed" as const };
      if (contract.status !== "released" || contract.signing_method !== "click") return { state: "not_released" as const };
      const updated = await client.query<{ id: string }>(`UPDATE sponsorship_contracts SET status = 'confirmed', confirmed_at = now(),
        confirmed_by = $3, confirmed_email = $4, confirmed_name = $5, confirmed_role = $6, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'released' RETURNING id`,
      [signing.tenant_id, signing.contract_id, `one-time:${signing.id}`, signing.signer_email, signing.signer_name, signing.signer_role]);
      if (!updated.rows[0]) return { state: "already_confirmed" as const };
      await client.query(`UPDATE contract_signing_requests SET status = 'confirmed', confirmed_at = now(),
        opened_at = COALESCE(opened_at, now()), updated_at = now() WHERE id = $1`, [signing.id]);
      await client.query(`INSERT INTO sponsorship_contract_events
        (tenant_id, contract_id, event_type, actor_user_id, actor_email, evidence)
        VALUES ($1,$2,'confirmed',$3,$4,jsonb_build_object(
          'snapshot_hash',$5::text,'signing_authority_name',$6::text,'signing_authority_role',$7::text,
          'user_agent',$8::text,'acknowledged',true,'confirmation_mode','one_time_link'))`,
      [signing.tenant_id, signing.contract_id, `one-time:${signing.id}`, signing.signer_email,
        contract.snapshot_hash, signing.signer_name, signing.signer_role,
        (request.headers.get("user-agent") ?? "unknown").slice(0, 500)]);
      return { state: "confirmed" as const };
    });

    if (result.state === "not_found" || result.state === "invalid") return json({ error: "contract_signing_link_invalid" }, 404);
    if (result.state === "expired") return json({ error: "contract_signing_link_expired" }, 410);
    if (result.state === "already_confirmed") return json({ error: "contract_already_confirmed" }, 409);
    if (result.state === "not_released") return json({ error: "contract_not_released" }, 409);
    if (result.state === "confirmed") return json({ confirmed: true });
    if (result.state === "pdf") return new Response(Uint8Array.from(result.bytes).buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Sponsoringvertrag_${result.number}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
    if (result.state !== "ready") return json({ error: "contract_signing_request_failed", requestId: context.requestId }, 500);
    return Response.json({
      contract: {
        contractNumber: result.contract.contract_number,
        title: result.contract.title,
        status: result.contract.status,
        snapshotHash: result.contract.snapshot_hash,
        releasedAt: result.contract.released_at,
        confirmedAt: result.contract.confirmed_at,
        organization: result.contract.organization_snapshot,
        sponsor: result.contract.sponsor_snapshot,
        package: result.contract.package_snapshot,
      },
      signer: { name: result.signing.signer_name, role: result.signing.signer_role, email: result.signing.signer_email },
      invitation: { status: result.signing.status, expiresAt: result.signing.expires_at },
    }, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    console.error("contract_signing_request_failed", { requestId: context.requestId, action, error });
    return json({ error: "contract_signing_request_failed", requestId: context.requestId }, 500);
  }
};

export const config: Config = {
  path: [
    "/api/contract-signing/:token",
    "/api/contract-signing/:token/pdf",
    "/api/contract-signing/:token/confirm",
  ],
};
