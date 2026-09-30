-- One sequence across tenants: all invoices can be paid to the same collection account.
CREATE SEQUENCE billing_invoice_number_seq;
ALTER TABLE billing_invoices DROP CONSTRAINT billing_invoices_status_check;
ALTER TABLE billing_invoices ADD CONSTRAINT billing_invoices_status_check CHECK (status IN ('draft','issued','cancelled'));
ALTER TABLE billing_invoices ADD COLUMN invoice_number text UNIQUE;
ALTER TABLE billing_invoices ADD COLUMN qr_reference text UNIQUE CHECK (qr_reference ~ '^\d{27}$');
ALTER TABLE billing_invoices ADD COLUMN payment_creditor jsonb;
ALTER TABLE billing_invoices ADD COLUMN issued_on date;
ALTER TABLE billing_invoices ADD COLUMN issued_by text;
ALTER TABLE billing_invoices ADD CONSTRAINT billing_issued_details CHECK (
  (status = 'issued' AND invoice_number IS NOT NULL AND qr_reference IS NOT NULL AND payment_creditor IS NOT NULL AND issued_on IS NOT NULL AND issued_by IS NOT NULL)
  OR (status <> 'issued' AND invoice_number IS NULL AND qr_reference IS NULL AND payment_creditor IS NULL AND issued_on IS NULL AND issued_by IS NULL)
);

-- Store the actual PDF atomically with issuance, separately from list responses.
CREATE TABLE billing_invoice_documents (
  invoice_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  pdf_bytes bytea NOT NULL CHECK (octet_length(pdf_bytes) BETWEEN 1 AND 5000000),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  FOREIGN KEY (invoice_id,tenant_id) REFERENCES billing_invoices(id,tenant_id)
);
ALTER TABLE billing_invoice_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoice_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_invoice_documents_tenant ON billing_invoice_documents
  USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

CREATE FUNCTION protect_issued_billing_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'issued' THEN RAISE EXCEPTION 'issued_billing_invoice_is_immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_issued_billing_invoice BEFORE UPDATE OR DELETE ON billing_invoices
  FOR EACH ROW EXECUTE FUNCTION protect_issued_billing_invoice();
CREATE FUNCTION protect_billing_invoice_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'billing_invoice_document_is_immutable'; END $$;
CREATE TRIGGER protect_billing_invoice_document BEFORE UPDATE OR DELETE ON billing_invoice_documents
  FOR EACH ROW EXECUTE FUNCTION protect_billing_invoice_document();
