CREATE TABLE sponsorship_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sponsorship_packages_tenant_idx ON sponsorship_packages(tenant_id, created_at DESC);

CREATE TABLE sponsorship_package_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES sponsorship_packages(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 3000),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  duration_months INTEGER NOT NULL CHECK (duration_months BETWEEN 1 AND 120),
  payment_plan TEXT NOT NULL CHECK (payment_plan IN ('annual', 'semiannual', 'quarterly', 'custom')),
  payment_terms TEXT CHECK (payment_terms IS NULL OR char_length(payment_terms) <= 500),
  valid_from DATE,
  valid_until DATE,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
  deviation_approval_required BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (package_id, version_number),
  UNIQUE (id, tenant_id),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);

CREATE UNIQUE INDEX sponsorship_package_versions_one_draft_idx
  ON sponsorship_package_versions(package_id) WHERE status = 'draft';
CREATE INDEX sponsorship_package_versions_tenant_idx
  ON sponsorship_package_versions(tenant_id, package_id, version_number DESC);

CREATE TABLE sponsorship_rights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  package_version_id UUID NOT NULL REFERENCES sponsorship_package_versions(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  schedule_text TEXT CHECK (schedule_text IS NULL OR char_length(schedule_text) <= 300),
  channel TEXT CHECK (channel IS NULL OR char_length(channel) <= 120),
  location TEXT CHECK (location IS NULL OR char_length(location) <= 160),
  responsible_role TEXT CHECK (responsible_role IS NULL OR char_length(responsible_role) <= 120),
  exclusivity_scope TEXT NOT NULL DEFAULT 'none'
    CHECK (exclusivity_scope IN ('none', 'industry', 'team', 'area', 'channel', 'period')),
  exclusivity_key TEXT CHECK (exclusivity_key IS NULL OR char_length(exclusivity_key) <= 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (exclusivity_scope = 'none' AND exclusivity_key IS NULL)
    OR (exclusivity_scope <> 'none' AND exclusivity_key IS NOT NULL)
  )
);

CREATE INDEX sponsorship_rights_version_idx
  ON sponsorship_rights(tenant_id, package_version_id, created_at);
CREATE INDEX sponsorship_rights_exclusivity_idx
  ON sponsorship_rights(tenant_id, exclusivity_scope, exclusivity_key)
  WHERE exclusivity_scope <> 'none';

CREATE TABLE sponsorship_package_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  package_version_id UUID NOT NULL,
  sponsor_id UUID NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'confirmed', 'released')),
  expires_at TIMESTAMPTZ,
  override_reason TEXT CHECK (override_reason IS NULL OR char_length(override_reason) BETWEEN 3 AND 2000),
  override_approved_by TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (package_version_id, tenant_id)
    REFERENCES sponsorship_package_versions(id, tenant_id) ON DELETE CASCADE,
  CHECK (
    (override_reason IS NULL AND override_approved_by IS NULL)
    OR (override_reason IS NOT NULL AND override_approved_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX sponsorship_package_reservations_active_sponsor_idx
  ON sponsorship_package_reservations(package_version_id, sponsor_id)
  WHERE status IN ('held', 'confirmed');
CREATE INDEX sponsorship_package_reservations_capacity_idx
  ON sponsorship_package_reservations(tenant_id, package_version_id, status);

CREATE OR REPLACE FUNCTION protect_published_package_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'published_package_version_is_immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER sponsorship_package_version_immutable
  BEFORE UPDATE OR DELETE ON sponsorship_package_versions
  FOR EACH ROW EXECUTE FUNCTION protect_published_package_version();

CREATE OR REPLACE FUNCTION protect_published_package_right()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_version UUID;
  target_status TEXT;
BEGIN
  target_version := CASE WHEN TG_OP = 'DELETE' THEN OLD.package_version_id ELSE NEW.package_version_id END;
  SELECT status INTO target_status FROM sponsorship_package_versions WHERE id = target_version;
  IF target_status <> 'draft' THEN
    RAISE EXCEPTION 'published_package_right_is_immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER sponsorship_right_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON sponsorship_rights
  FOR EACH ROW EXECUTE FUNCTION protect_published_package_right();

CREATE OR REPLACE FUNCTION enforce_package_reservation_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  total_capacity INTEGER;
  reserved_quantity INTEGER;
  has_exclusivity_conflict BOOLEAN;
  exclusivity_lock RECORD;
BEGIN
  IF NEW.status = 'released' THEN
    RETURN NEW;
  END IF;

  SELECT capacity INTO total_capacity
  FROM sponsorship_package_versions
  WHERE id = NEW.package_version_id AND tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package_version_not_found' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF total_capacity IS NOT NULL THEN
    SELECT COALESCE(sum(quantity), 0)::integer INTO reserved_quantity
    FROM sponsorship_package_reservations
    WHERE tenant_id = NEW.tenant_id
      AND package_version_id = NEW.package_version_id
      AND status IN ('held', 'confirmed')
      AND (status = 'confirmed' OR expires_at IS NULL OR expires_at > now())
      AND id <> NEW.id;
    IF reserved_quantity + NEW.quantity > total_capacity THEN
      RAISE EXCEPTION 'package_capacity_exceeded' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  FOR exclusivity_lock IN
    SELECT exclusivity_scope, exclusivity_key
    FROM sponsorship_rights
    WHERE package_version_id = NEW.package_version_id AND exclusivity_scope <> 'none'
    ORDER BY exclusivity_scope, exclusivity_key
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      NEW.tenant_id::text || ':' || exclusivity_lock.exclusivity_scope || ':' || exclusivity_lock.exclusivity_key,
      0
    ));
  END LOOP;

  SELECT EXISTS (
    SELECT 1
    FROM sponsorship_rights requested_right
    JOIN sponsorship_package_versions requested_version ON requested_version.id = requested_right.package_version_id
    JOIN sponsorship_package_reservations existing_reservation
      ON existing_reservation.tenant_id = NEW.tenant_id
     AND existing_reservation.status IN ('held', 'confirmed')
     AND (existing_reservation.status = 'confirmed' OR existing_reservation.expires_at IS NULL OR existing_reservation.expires_at > now())
     AND existing_reservation.id <> NEW.id
     AND existing_reservation.sponsor_id <> NEW.sponsor_id
    JOIN sponsorship_package_versions existing_version ON existing_version.id = existing_reservation.package_version_id
    JOIN sponsorship_rights existing_right
      ON existing_right.package_version_id = existing_reservation.package_version_id
     AND existing_right.exclusivity_scope = requested_right.exclusivity_scope
     AND existing_right.exclusivity_key = requested_right.exclusivity_key
    WHERE requested_right.package_version_id = NEW.package_version_id
      AND requested_right.exclusivity_scope <> 'none'
      AND COALESCE(existing_version.valid_until, 'infinity'::date) >= COALESCE(requested_version.valid_from, '-infinity'::date)
      AND COALESCE(requested_version.valid_until, 'infinity'::date) >= COALESCE(existing_version.valid_from, '-infinity'::date)
  ) INTO has_exclusivity_conflict;

  IF has_exclusivity_conflict AND (NEW.override_reason IS NULL OR NEW.override_approved_by IS NULL) THEN
    RAISE EXCEPTION 'package_exclusivity_conflict' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sponsorship_package_reservation_guard
  BEFORE INSERT OR UPDATE OF package_version_id, quantity, status, expires_at ON sponsorship_package_reservations
  FOR EACH ROW EXECUTE FUNCTION enforce_package_reservation_rules();

ALTER TABLE sponsorship_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_package_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_rights ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_package_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_packages FORCE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_package_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_rights FORCE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_package_reservations FORCE ROW LEVEL SECURITY;

CREATE POLICY sponsorship_packages_isolated ON sponsorship_packages
  USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY sponsorship_package_versions_isolated ON sponsorship_package_versions
  USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY sponsorship_rights_isolated ON sponsorship_rights
  USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY sponsorship_package_reservations_isolated ON sponsorship_package_reservations
  USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
