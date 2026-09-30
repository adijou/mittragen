-- New invoices combine the bill and QR payment part on one A4 sheet.
-- Previously issued immutable multi-page documents remain supported.
ALTER TABLE billing_postal_dispatches
  DROP CONSTRAINT billing_postal_dispatches_page_count_check,
  ADD CONSTRAINT billing_postal_dispatches_page_count_check CHECK (page_count BETWEEN 1 AND 100);
