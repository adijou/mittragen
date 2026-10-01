import type { DatabaseClient } from "./database.ts";
import { BillingError } from "./billing-ledger.ts";
import { swissToday } from "../../../shared/billing.ts";

export function clubFeeSettlement(contribution: number, fee: number, received: number, platformReceived: number) {
  if (![contribution,fee,received,platformReceived].every(Number.isSafeInteger) || contribution <= 0 || fee <= 0
    || received < contribution || received >= contribution + fee || platformReceived < 0 || platformReceived > fee) {
    throw new BillingError("billing_fee_settlement_not_eligible");
  }
  return { waivedCents: contribution + fee - received, feeCents: fee,
    receivedPlatformCents: platformReceived, clubChargeCents: fee - platformReceived };
}

/** Caller holds the tenant billing lock. Never modify the invoice PDF or fabricate a receipt. */
export async function assumeFeeByClub(client: DatabaseClient, tenantId: string, actor: string, invoiceId: string, reason: string) {
  const previous=await client.query<{id:string}>("SELECT id FROM billing_fee_settlements WHERE tenant_id=$1 AND invoice_id=$2 AND reversed_at IS NULL",[tenantId,invoiceId]);
  if(previous.rows[0])return previous.rows[0].id;
  const invoice=(await client.query<{contribution_cents:number;platform_fee_cents:number;status:string}>("SELECT contribution_cents,platform_fee_cents,status FROM billing_invoices WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[tenantId,invoiceId])).rows[0];
  if(!invoice)throw new BillingError("not_found",404);
  if(invoice.status!=="issued")throw new BillingError("billing_fee_settlement_requires_invoice");
  const receipts=(await client.query<{received:string;platform:string}>("SELECT COALESCE(sum(amount_cents),0)::text received,COALESCE(sum(platform_cents),0)::text platform FROM billing_receipts WHERE tenant_id=$1 AND invoice_id=$2 AND reversed_at IS NULL",[tenantId,invoiceId])).rows[0];
  const amounts=clubFeeSettlement(invoice.contribution_cents,invoice.platform_fee_cents,Number(receipts.received),Number(receipts.platform));
  const saved=await client.query<{id:string}>(`INSERT INTO billing_fee_settlements
    (tenant_id,invoice_id,waived_cents,fee_cents,received_platform_cents,club_charge_cents,booked_on,reason,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[tenantId,invoiceId,amounts.waivedCents,amounts.feeCents,amounts.receivedPlatformCents,amounts.clubChargeCents,swissToday(),reason,actor]);
  const id=saved.rows[0].id;
  await client.query(`INSERT INTO audit_events(tenant_id,actor_user_id,action,object_type,object_id,metadata)
    VALUES($1,$2,'billing.fee_assumed_by_club','billing',$3,$4::jsonb)`,[tenantId,actor,id,JSON.stringify({invoiceId,reason,...amounts})]);
  return id;
}

export async function reverseFeeSettlement(client:DatabaseClient,tenantId:string,actor:string,id:string,reason:string) {
  const row=(await client.query<{reversed_at:string|null}>("SELECT reversed_at FROM billing_fee_settlements WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[tenantId,id])).rows[0];
  if(!row)throw new BillingError("not_found",404);
  if(row.reversed_at)return;
  const assigned=await client.query("SELECT payout_id FROM billing_payout_fee_items WHERE tenant_id=$1 AND settlement_id=$2 LIMIT 1",[tenantId,id]);
  if(assigned.rows.length)throw new BillingError("billing_fee_settlement_locked");
  await client.query("UPDATE billing_fee_settlements SET reversed_at=now(),reversal_reason=$3 WHERE tenant_id=$1 AND id=$2",[tenantId,id,reason]);
  await client.query(`INSERT INTO audit_events(tenant_id,actor_user_id,action,object_type,object_id,metadata)
    VALUES($1,$2,'billing.fee_settlement_reversed','billing',$3,jsonb_build_object('reason',$4::text))`,[tenantId,actor,id,reason]);
}

export async function availableFeeCharges(client:DatabaseClient,tenantId:string,month:string) {
  return (await client.query<{id:string;remaining_cents:string}>(`SELECT fee.id,
    (fee.club_charge_cents-COALESCE(sum(item.amount_cents),0))::text remaining_cents
    FROM billing_fee_settlements fee LEFT JOIN billing_payout_fee_items item ON item.settlement_id=fee.id AND item.tenant_id=fee.tenant_id
    WHERE fee.tenant_id=$1 AND fee.reversed_at IS NULL AND fee.booked_on < ($2::date + interval '1 month')
    GROUP BY fee.id HAVING fee.club_charge_cents>COALESCE(sum(item.amount_cents),0) ORDER BY fee.booked_on,fee.created_at,fee.id`,[tenantId,`${month}-01`])).rows;
}

export async function requireFreshFeeCharges(client:DatabaseClient,tenantId:string,payoutId:string) {
  const changed=await client.query(`SELECT fee.id FROM billing_fee_settlements fee JOIN billing_payouts payout ON payout.tenant_id=fee.tenant_id
    WHERE payout.tenant_id=$1 AND payout.id=$2 AND fee.booked_on < (to_date(payout.through_month,'YYYY-MM') + interval '1 month')
    AND (fee.created_at>payout.created_at OR fee.reversed_at>payout.created_at) LIMIT 1`,[tenantId,payoutId]);
  if(changed.rows.length)throw new BillingError("billing_payout_costs_changed");
}
