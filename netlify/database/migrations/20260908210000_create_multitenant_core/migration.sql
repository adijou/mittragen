CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE tenant_kind AS ENUM ('club', 'association', 'event', 'project');
CREATE TYPE tenant_status AS ENUM ('onboarding', 'active', 'suspended');
CREATE TYPE membership_role AS ENUM ('owner', 'sponsoring_admin', 'finance', 'fulfillment', 'viewer');

CREATE OR REPLACE FUNCTION app_current_tenant_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::UUID
$$;

CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')
$$;

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  kind tenant_kind NOT NULL DEFAULT 'club',
  status tenant_status NOT NULL DEFAULT 'onboarding',
  default_currency CHAR(3) NOT NULL DEFAULT 'CHF',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  identity_user_id TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  role membership_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, identity_user_id)
);

CREATE INDEX tenant_memberships_user_idx ON tenant_memberships(identity_user_id);

CREATE TABLE sponsors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL,
  source_organization TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  proposal_package TEXT,
  annual_value_cents INTEGER NOT NULL DEFAULT 0 CHECK (annual_value_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sponsors_tenant_idx ON sponsors(tenant_id);

CREATE TABLE tenant_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role membership_role NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  invited_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tenant_invitations_tenant_idx ON tenant_invitations(tenant_id);

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_tenant_created_idx ON audit_events(tenant_id, created_at DESC);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE sponsors FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY memberships_isolated ON tenant_memberships
  USING (
    tenant_id = app_current_tenant_id()
    OR identity_user_id = app_current_user_id()
  )
  WITH CHECK (tenant_id = app_current_tenant_id());

CREATE POLICY tenants_isolated ON tenants
  USING (
    id = app_current_tenant_id()
    OR EXISTS (
      SELECT 1
      FROM tenant_memberships membership
      WHERE membership.tenant_id = tenants.id
        AND membership.identity_user_id = app_current_user_id()
    )
  )
  WITH CHECK (id = app_current_tenant_id());

CREATE POLICY sponsors_isolated ON sponsors
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

CREATE POLICY invitations_isolated ON tenant_invitations
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

CREATE POLICY audit_events_isolated ON audit_events
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

