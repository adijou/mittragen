CREATE TABLE billing_postal_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), invoice_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('staging','production')), organisation_id text NOT NULL,
  status text NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing','validating','ready','sending','submitted','sent','delivered','undeliverable','cancelled','needs_review')),
  provider_letter_id text, provider_status text, provider_updated_at timestamptz,
  file_name text NOT NULL, pdf_sha256 text NOT NULL, page_count integer NOT NULL CHECK (page_count BETWEEN 2 AND 100),
  paper_types jsonb NOT NULL, provider_address text, quoted_cents integer CHECK (quoted_cents >= 0), quote_token uuid, quoted_at timestamptz,
  approved_cents integer CHECK (approved_cents >= 0), approved_by text, approved_at timestamptz,
  create_started_at timestamptz, send_started_at timestamptz, send_key uuid NOT NULL DEFAULT gen_random_uuid(), submitted_at timestamptz,
  cost_confirmed boolean NOT NULL DEFAULT false, refresh_token uuid, refresh_started_at timestamptz, last_error text, created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,tenant_id), UNIQUE (tenant_id,invoice_id,environment), UNIQUE (environment,organisation_id,provider_letter_id),
  FOREIGN KEY (invoice_id,tenant_id) REFERENCES billing_invoices(id,tenant_id)
);
CREATE TABLE billing_postal_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), dispatch_id uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents <> 0), currency text NOT NULL DEFAULT 'CHF' CHECK (currency='CHF'),
  booked_on date NOT NULL, provider_total_cents integer NOT NULL CHECK (provider_total_cents >= 0),
  provider_updated_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,tenant_id), FOREIGN KEY (dispatch_id,tenant_id) REFERENCES billing_postal_dispatches(id,tenant_id)
);
CREATE TABLE billing_payout_postal_items (
  tenant_id uuid NOT NULL REFERENCES tenants(id), payout_id uuid NOT NULL, cost_id uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents<>0), PRIMARY KEY (payout_id,cost_id),
  FOREIGN KEY (payout_id,tenant_id) REFERENCES billing_payouts(id,tenant_id),
  FOREIGN KEY (cost_id,tenant_id) REFERENCES billing_postal_costs(id,tenant_id)
);
CREATE TABLE billing_pingen_webhook_events (
  tenant_id uuid NOT NULL REFERENCES tenants(id), environment text NOT NULL, organisation_id text NOT NULL, event_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(environment,organisation_id,event_id)
);
ALTER TABLE billing_postal_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_postal_dispatches FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_postal_dispatches_tenant ON billing_postal_dispatches
 USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
-- Only the signed webhook's internal session can resolve a known provider letter to its tenant.
CREATE POLICY billing_postal_dispatches_webhook_lookup ON billing_postal_dispatches FOR SELECT
 USING (current_setting('app.user_id',true)='system:pingen-webhook');
ALTER TABLE billing_postal_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_postal_costs FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_postal_costs_tenant ON billing_postal_costs USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
ALTER TABLE billing_payout_postal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_payout_postal_items FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_payout_postal_items_tenant ON billing_payout_postal_items USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
ALTER TABLE billing_pingen_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_pingen_webhook_events FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_pingen_webhook_events_tenant ON billing_pingen_webhook_events USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
CREATE TRIGGER protect_postal_cost_entry BEFORE UPDATE OR DELETE ON billing_postal_costs FOR EACH ROW EXECUTE FUNCTION protect_billing_invoice_document();

ALTER TABLE billing_payouts DROP CONSTRAINT billing_payouts_amount_cents_check;
ALTER TABLE billing_payouts DROP CONSTRAINT billing_payouts_status_check;
ALTER TABLE billing_payouts DROP CONSTRAINT billing_payouts_check;
ALTER TABLE billing_payouts ADD COLUMN gross_cents bigint;
ALTER TABLE billing_payouts ADD COLUMN postal_cents bigint NOT NULL DEFAULT 0;
UPDATE billing_payouts SET gross_cents=amount_cents;
ALTER TABLE billing_payouts ALTER COLUMN gross_cents SET NOT NULL;
ALTER TABLE billing_payouts ADD COLUMN settled_on date;
ALTER TABLE billing_payouts ADD CONSTRAINT billing_payout_totals CHECK (gross_cents>=0 AND amount_cents>=0 AND amount_cents=gross_cents-postal_cents);
ALTER TABLE billing_payouts ADD CONSTRAINT billing_payout_state CHECK (
 (status='prepared' AND paid_on IS NULL AND bank_reference IS NULL AND recorded_by IS NULL AND settled_on IS NULL)
 OR (status='paid' AND amount_cents>0 AND paid_on IS NOT NULL AND length(bank_reference) BETWEEN 3 AND 200 AND recorded_by IS NOT NULL AND settled_on IS NULL)
 OR (status='offset' AND amount_cents=0 AND settled_on IS NOT NULL AND recorded_by IS NOT NULL AND paid_on IS NULL AND bank_reference IS NULL)
);
CREATE INDEX billing_postal_costs_booked ON billing_postal_costs(tenant_id,booked_on);
