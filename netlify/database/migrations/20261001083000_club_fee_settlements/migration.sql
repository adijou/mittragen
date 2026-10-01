-- A sponsor's unpaid surcharge may be assumed by the club. It is not a bank receipt.
CREATE TABLE billing_fee_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id), invoice_id uuid NOT NULL,
  waived_cents integer NOT NULL CHECK (waived_cents > 0),
  fee_cents integer NOT NULL CHECK (fee_cents > 0),
  received_platform_cents integer NOT NULL CHECK (received_platform_cents >= 0),
  club_charge_cents integer NOT NULL CHECK (club_charge_cents >= 0),
  booked_on date NOT NULL, reason text NOT NULL CHECK (length(reason) BETWEEN 5 AND 500),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz, reversal_reason text,
  UNIQUE (id,tenant_id), FOREIGN KEY (invoice_id,tenant_id) REFERENCES billing_invoices(id,tenant_id),
  CHECK (waived_cents <= fee_cents),
  CHECK (club_charge_cents = fee_cents - received_platform_cents),
  CHECK ((reversed_at IS NULL) = (reversal_reason IS NULL))
);
CREATE UNIQUE INDEX billing_fee_settlement_active ON billing_fee_settlements(tenant_id,invoice_id) WHERE reversed_at IS NULL;
CREATE TABLE billing_payout_fee_items (
  tenant_id uuid NOT NULL REFERENCES tenants(id), payout_id uuid NOT NULL, settlement_id uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0), PRIMARY KEY (payout_id,settlement_id),
  FOREIGN KEY (payout_id,tenant_id) REFERENCES billing_payouts(id,tenant_id),
  FOREIGN KEY (settlement_id,tenant_id) REFERENCES billing_fee_settlements(id,tenant_id)
);
ALTER TABLE billing_payouts ADD COLUMN fee_cents bigint NOT NULL DEFAULT 0 CHECK (fee_cents >= 0);
ALTER TABLE billing_payouts DROP CONSTRAINT billing_payout_totals;
ALTER TABLE billing_payouts ADD CONSTRAINT billing_payout_totals CHECK (
  gross_cents >= 0 AND amount_cents >= 0 AND amount_cents = gross_cents - postal_cents - fee_cents
);
ALTER TABLE billing_fee_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_fee_settlements FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_fee_settlements_tenant ON billing_fee_settlements
 USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
ALTER TABLE billing_payout_fee_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_payout_fee_items FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_payout_fee_items_tenant ON billing_payout_fee_items
 USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
