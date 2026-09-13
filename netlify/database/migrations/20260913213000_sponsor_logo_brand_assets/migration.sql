ALTER TABLE sponsors
  ADD COLUMN logo_blob_key TEXT CHECK (logo_blob_key IS NULL OR char_length(logo_blob_key) <= 300),
  ADD COLUMN logo_content_type TEXT CHECK (logo_content_type IS NULL OR logo_content_type IN ('image/png', 'image/jpeg')),
  ADD COLUMN logo_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN sponsors.logo_blob_key IS
  'Privater, vom Sponsorportal verwalteter Verweis auf das aktuelle Sponsorlogo.';
