-- Existing bookings retain zero surcharge. New bookings snapshot the disclosed terms.
ALTER TABLE event_sponsorship_bookings ADD COLUMN fee_basis_points integer NOT NULL DEFAULT 0 CHECK (fee_basis_points IN (0,250));
ALTER TABLE event_sponsorship_bookings ADD COLUMN collection_notice text NOT NULL DEFAULT '';
ALTER TABLE event_sponsorship_bookings ADD COLUMN checkout_key uuid;
CREATE UNIQUE INDEX event_booking_checkout_key ON event_sponsorship_bookings(tenant_id, checkout_key);

CREATE TABLE billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_type text NOT NULL CHECK (source_type IN ('event_booking','contract')),
  source_id uuid NOT NULL,
  source_key text NOT NULL,
  period_start date,
  period_end date,
  reference text NOT NULL,
  description text NOT NULL,
  recipient jsonb NOT NULL,
  issuer jsonb NOT NULL,
  contribution_cents integer NOT NULL CHECK (contribution_cents > 0 AND contribution_cents <= 100000000),
  fee_basis_points integer NOT NULL CHECK (fee_basis_points IN (0,250)),
  platform_fee_cents integer NOT NULL CHECK (platform_fee_cents >= 0),
  collection_notice text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','cancelled')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, source_key),
  UNIQUE (tenant_id, reference),
  CHECK (platform_fee_cents = floor((contribution_cents::bigint * fee_basis_points + 5000) / 10000))
);

CREATE TABLE billing_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  invoice_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  bank_reference text NOT NULL CHECK (length(bank_reference) BETWEEN 3 AND 200),
  received_on date NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  club_cents integer NOT NULL CHECK (club_cents >= 0),
  platform_cents integer NOT NULL CHECK (platform_cents >= 0),
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  reversal_reason text,
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (invoice_id, tenant_id) REFERENCES billing_invoices(id, tenant_id),
  CHECK (amount_cents = club_cents + platform_cents),
  CHECK ((reversed_at IS NULL) = (reversal_reason IS NULL))
);
CREATE UNIQUE INDEX billing_active_bank_reference ON billing_receipts(bank_reference) WHERE reversed_at IS NULL;

CREATE TABLE billing_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  through_month text NOT NULL CHECK (through_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','paid')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_on date,
  bank_reference text,
  recorded_by text,
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, through_month),
  CHECK ((status = 'prepared' AND paid_on IS NULL AND bank_reference IS NULL AND recorded_by IS NULL)
    OR (status = 'paid' AND paid_on IS NOT NULL AND length(bank_reference) BETWEEN 3 AND 200 AND recorded_by IS NOT NULL))
);
CREATE UNIQUE INDEX billing_payout_bank_reference ON billing_payouts(bank_reference) WHERE bank_reference IS NOT NULL;

CREATE TABLE billing_payout_items (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  payout_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  PRIMARY KEY (tenant_id, receipt_id),
  FOREIGN KEY (payout_id, tenant_id) REFERENCES billing_payouts(id, tenant_id),
  FOREIGN KEY (receipt_id, tenant_id) REFERENCES billing_receipts(id, tenant_id)
);

CREATE INDEX billing_receipts_invoice ON billing_receipts(tenant_id, invoice_id);
CREATE INDEX billing_invoices_date ON billing_invoices(tenant_id, created_at DESC);
ALTER TABLE billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_invoices_isolated ON billing_invoices USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
ALTER TABLE billing_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_receipts_isolated ON billing_receipts USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
ALTER TABLE billing_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_payouts FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_payouts_isolated ON billing_payouts USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
ALTER TABLE billing_payout_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_payout_items FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_payout_items_isolated ON billing_payout_items USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
