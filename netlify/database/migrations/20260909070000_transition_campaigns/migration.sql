CREATE TABLE transition_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 160),
  target_period TEXT NOT NULL CHECK (char_length(target_period) BETWEEN 2 AND 80),
  response_deadline DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'ready', 'active', 'closed')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX transition_campaigns_tenant_created_idx
  ON transition_campaigns(tenant_id, created_at DESC);

CREATE TABLE transition_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES transition_campaigns(id) ON DELETE CASCADE,
  source_package TEXT NOT NULL CHECK (char_length(source_package) BETWEEN 1 AND 160),
  target_package TEXT NOT NULL CHECK (char_length(target_package) BETWEEN 1 AND 160),
  target_value_cents INTEGER NOT NULL CHECK (target_value_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, source_package)
);

CREATE INDEX transition_mappings_campaign_idx
  ON transition_mappings(tenant_id, campaign_id, source_package);

CREATE TABLE transition_sponsors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES transition_campaigns(id) ON DELETE CASCADE,
  sponsor_id UUID NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  source_package TEXT NOT NULL CHECK (char_length(source_package) BETWEEN 1 AND 160),
  source_value_cents INTEGER NOT NULL CHECK (source_value_cents >= 0),
  proposed_package TEXT NOT NULL CHECK (char_length(proposed_package) BETWEEN 1 AND 160),
  proposed_value_cents INTEGER NOT NULL CHECK (proposed_value_cents >= 0),
  status TEXT NOT NULL DEFAULT 'review'
    CHECK (status IN ('review', 'ready', 'sent', 'opened', 'question', 'confirmed', 'declined', 'exception')),
  exception_note TEXT CHECK (exception_note IS NULL OR char_length(exception_note) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, sponsor_id)
);

CREATE INDEX transition_sponsors_campaign_status_idx
  ON transition_sponsors(tenant_id, campaign_id, status);

ALTER TABLE transition_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE transition_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE transition_sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE transition_campaigns FORCE ROW LEVEL SECURITY;
ALTER TABLE transition_mappings FORCE ROW LEVEL SECURITY;
ALTER TABLE transition_sponsors FORCE ROW LEVEL SECURITY;

CREATE POLICY transition_campaigns_isolated ON transition_campaigns
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

CREATE POLICY transition_mappings_isolated ON transition_mappings
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

CREATE POLICY transition_sponsors_isolated ON transition_sponsors
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
