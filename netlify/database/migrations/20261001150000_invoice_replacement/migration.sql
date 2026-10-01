-- Keep cancelled documents and delivery/payment evidence; only active invoices reserve a source.
ALTER TABLE billing_invoices ADD COLUMN cancelled_by text;
ALTER TABLE billing_invoices ADD COLUMN cancellation_reason text;
ALTER TABLE billing_invoices ADD COLUMN replacement_for uuid;
ALTER TABLE billing_invoices ADD CONSTRAINT billing_invoice_replacement_tenant
  FOREIGN KEY (replacement_for,tenant_id) REFERENCES billing_invoices(id,tenant_id);
CREATE UNIQUE INDEX billing_invoice_one_replacement ON billing_invoices(tenant_id,replacement_for)
  WHERE replacement_for IS NOT NULL;
ALTER TABLE billing_invoices DROP CONSTRAINT billing_invoices_tenant_id_source_key_key;
CREATE UNIQUE INDEX billing_invoice_active_source ON billing_invoices(tenant_id,source_key)
  WHERE status <> 'cancelled';

ALTER TABLE billing_invoices DROP CONSTRAINT billing_issued_details;
ALTER TABLE billing_invoices ADD CONSTRAINT billing_issued_details CHECK (
  (status IN ('issued','cancelled') AND invoice_number IS NOT NULL AND qr_reference IS NOT NULL AND payment_creditor IS NOT NULL AND issued_on IS NOT NULL AND issued_by IS NOT NULL)
  OR (status IN ('draft','cancelled') AND invoice_number IS NULL AND qr_reference IS NULL AND payment_creditor IS NULL AND issued_on IS NULL AND issued_by IS NULL)
);
CREATE OR REPLACE FUNCTION protect_issued_billing_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('issued','cancelled') THEN
    IF TG_OP = 'UPDATE' AND OLD.status = 'issued' AND NEW.status = 'cancelled'
      AND NEW.cancelled_at IS NOT NULL AND NEW.cancelled_by IS NOT NULL AND length(NEW.cancellation_reason) >= 5
      AND (to_jsonb(NEW) - ARRAY['status','cancelled_at','cancelled_by','cancellation_reason'])
        = (to_jsonb(OLD) - ARRAY['status','cancelled_at','cancelled_by','cancellation_reason']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'issued_billing_invoice_is_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
