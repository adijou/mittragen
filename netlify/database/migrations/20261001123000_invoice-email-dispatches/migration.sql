CREATE TABLE billing_email_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  invoice_id uuid NOT NULL,
  recipient_email text NOT NULL CHECK (length(recipient_email) BETWEEN 3 AND 254),
  pdf_sha256 text NOT NULL CHECK (pdf_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('sending','accepted','needs_review')),
  provider_id text,
  first_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  last_error text,
  created_by text NOT NULL,
  UNIQUE (tenant_id,invoice_id),
  FOREIGN KEY (invoice_id,tenant_id) REFERENCES billing_invoices(id,tenant_id),
  CHECK (status <> 'accepted' OR (provider_id IS NOT NULL AND accepted_at IS NOT NULL))
);
ALTER TABLE billing_email_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_email_dispatches FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_email_dispatches_tenant ON billing_email_dispatches
 USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
