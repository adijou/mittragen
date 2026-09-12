ALTER TABLE tenant_contract_settings
  ALTER COLUMN brand_primary_color SET DEFAULT '#0B2142',
  ALTER COLUMN brand_accent_color SET DEFAULT '#1F6BFF';

COMMENT ON COLUMN tenant_contract_settings.brand_primary_color IS
  'Organisationsfarbe; neue Profile starten mit dem barrierearmen mittragen.ch Navy.';
COMMENT ON COLUMN tenant_contract_settings.brand_accent_color IS
  'Organisationsakzent; neue Profile starten mit dem mittragen.ch Kobaltblau.';
