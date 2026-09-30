import type { DatabaseClient } from "./database.ts";
import { BillingError } from "./billing-ledger.ts";

export async function requireConfirmedPostalCosts(client:DatabaseClient,tenantId:string,month:string) {
  const pending=await client.query(`SELECT id FROM billing_postal_dispatches WHERE tenant_id=$1 AND environment='production'
    AND (send_started_at AT TIME ZONE 'Europe/Zurich') < ($2::date + interval '1 month') AND cost_confirmed=false LIMIT 1`,[tenantId,`${month}-01`]);
  if(pending.rows.length)throw new BillingError("billing_postal_costs_pending");
}

export async function availablePostalCosts(client:DatabaseClient,tenantId:string,month:string) {
  return (await client.query<{id:string;remaining_cents:string}>(`SELECT cost.id,
    (cost.amount_cents-COALESCE(sum(item.amount_cents),0))::text remaining_cents
    FROM billing_postal_costs cost LEFT JOIN billing_payout_postal_items item ON item.cost_id=cost.id AND item.tenant_id=cost.tenant_id
    WHERE cost.tenant_id=$1 AND cost.booked_on < ($2::date + interval '1 month')
    GROUP BY cost.id HAVING cost.amount_cents<>COALESCE(sum(item.amount_cents),0) ORDER BY cost.booked_on,cost.created_at,cost.id`,[tenantId,`${month}-01`])).rows;
}

/** Credits are consumed first. Charges exceeding available money remain open for later months. */
export function allocatePostalCosts(grossCents:number,costs:Array<{id:string;remaining_cents:string}>) {
  let available=grossCents;
  const items:Array<{id:string;amountCents:number}>=[];
  for(const cost of costs.filter(row=>Number(row.remaining_cents)<0)) {
    const amount=Number(cost.remaining_cents);items.push({id:cost.id,amountCents:amount});available-=amount;
  }
  for(const cost of costs.filter(row=>Number(row.remaining_cents)>0)) {
    const amount=Math.min(available,Number(cost.remaining_cents));
    if(amount>0){items.push({id:cost.id,amountCents:amount});available-=amount;}
  }
  return {items,netCents:available,postalCents:grossCents-available};
}

export async function requireFreshPayoutCosts(client:DatabaseClient,tenantId:string,payoutId:string) {
  const rows=await client.query<{through_month:string}>("SELECT through_month FROM billing_payouts WHERE tenant_id=$1 AND id=$2",[tenantId,payoutId]);
  const month=rows.rows[0]?.through_month;
  if(!month)throw new BillingError("billing_payout_not_found",404);
  await requireConfirmedPostalCosts(client,tenantId,month);
  const fresh=await client.query(`SELECT cost.id FROM billing_postal_costs cost JOIN billing_payouts payout ON payout.tenant_id=cost.tenant_id
    WHERE payout.tenant_id=$1 AND payout.id=$2 AND cost.booked_on < (to_date(payout.through_month,'YYYY-MM') + interval '1 month')
      AND cost.created_at>payout.created_at LIMIT 1`,[tenantId,payoutId]);
  if(fresh.rows.length)throw new BillingError("billing_payout_costs_changed");
}
