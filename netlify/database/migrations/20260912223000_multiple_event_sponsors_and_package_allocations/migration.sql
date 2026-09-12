DROP INDEX IF EXISTS event_sponsorship_one_active_booking_idx;

ALTER TABLE sponsorship_events
  ADD COLUMN home_coach TEXT CHECK (home_coach IS NULL OR char_length(home_coach) <= 160),
  ADD COLUMN opponent_coach TEXT CHECK (opponent_coach IS NULL OR char_length(opponent_coach) <= 160),
  ADD COLUMN referee_name TEXT CHECK (referee_name IS NULL OR char_length(referee_name) <= 160),
  ADD COLUMN match_info_url TEXT CHECK (match_info_url IS NULL OR char_length(match_info_url) <= 1000),
  ADD COLUMN speaker_note TEXT CHECK (speaker_note IS NULL OR char_length(speaker_note) <= 2000);

CREATE TABLE event_package_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id UUID NOT NULL,
  sponsor_id UUID NOT NULL,
  package_version_id UUID NOT NULL,
  sponsorship_right_id UUID NOT NULL REFERENCES sponsorship_rights(id),
  season_key TEXT NOT NULL CHECK (char_length(season_key) BETWEEN 1 AND 80),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  status TEXT NOT NULL DEFAULT 'allocated' CHECK (status IN ('allocated', 'cancelled')),
  created_by TEXT NOT NULL,
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, tenant_id) REFERENCES sponsorship_events(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (sponsor_id, tenant_id) REFERENCES sponsors(id, tenant_id),
  FOREIGN KEY (package_version_id, tenant_id)
    REFERENCES sponsorship_package_versions(id, tenant_id),
  CHECK ((status = 'allocated' AND cancelled_at IS NULL) OR (status = 'cancelled' AND cancelled_at IS NOT NULL))
);

CREATE UNIQUE INDEX event_package_allocations_one_sponsor_per_event_idx
  ON event_package_allocations(event_id, sponsor_id)
  WHERE status = 'allocated';
CREATE INDEX event_package_allocations_entitlement_idx
  ON event_package_allocations(tenant_id, sponsor_id, sponsorship_right_id, season_key)
  WHERE status = 'allocated';
CREATE INDEX event_package_allocations_event_idx
  ON event_package_allocations(tenant_id, event_id, allocated_at);

CREATE OR REPLACE FUNCTION enforce_event_package_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  allowance INTEGER;
  used_count INTEGER;
  sponsor_is_entitled BOOLEAN;
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  SELECT GREATEST(
    right_item.quantity,
    COALESCE(((regexp_match(
      lower(concat_ws(' ', right_item.name, right_item.description, right_item.schedule_text, right_item.channel)),
      '([0-9]+)[^0-9]{0,30}(matchball|matchspiel|heimspiel)'
    ))[1])::integer, 0)
  ) INTO allowance
  FROM sponsorship_rights right_item
  WHERE right_item.id = NEW.sponsorship_right_id
    AND right_item.tenant_id = NEW.tenant_id
    AND right_item.package_version_id = NEW.package_version_id
    AND lower(concat_ws(' ', right_item.name, right_item.description, right_item.schedule_text, right_item.channel))
      ~ '(matchball|match[ -]?spiel|heimspiel)'
  LIMIT 1;

  IF allowance IS NULL THEN
    RAISE EXCEPTION 'matchball_entitlement_not_found' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT (
    sponsor.assigned_package_version_id = NEW.package_version_id
    OR EXISTS (
      SELECT 1 FROM sponsorship_contracts contract
      WHERE contract.tenant_id = NEW.tenant_id
        AND contract.sponsor_id = NEW.sponsor_id
        AND contract.package_version_id = NEW.package_version_id
        AND contract.status IN ('released', 'confirmed')
    )
  ) INTO sponsor_is_entitled
  FROM sponsors sponsor
  WHERE sponsor.tenant_id = NEW.tenant_id AND sponsor.id = NEW.sponsor_id;

  IF NOT COALESCE(sponsor_is_entitled, false) THEN
    RAISE EXCEPTION 'sponsor_matchball_entitlement_not_found' USING ERRCODE = 'foreign_key_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.tenant_id::text || ':' || NEW.sponsor_id::text || ':' ||
    NEW.sponsorship_right_id::text || ':' || NEW.season_key,
    0
  ));

  SELECT count(*)::integer INTO used_count
  FROM event_package_allocations allocation
  WHERE allocation.tenant_id = NEW.tenant_id
    AND allocation.sponsor_id = NEW.sponsor_id
    AND allocation.sponsorship_right_id = NEW.sponsorship_right_id
    AND allocation.season_key = NEW.season_key
    AND allocation.status = 'allocated'
    AND allocation.id <> NEW.id;

  IF used_count >= allowance THEN
    RAISE EXCEPTION 'matchball_entitlement_exhausted' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER event_package_allocation_guard
  BEFORE INSERT OR UPDATE OF sponsor_id, package_version_id, sponsorship_right_id, season_key, status
  ON event_package_allocations
  FOR EACH ROW EXECUTE FUNCTION enforce_event_package_allocation();

ALTER TABLE event_package_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_package_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY event_package_allocations_isolated ON event_package_allocations
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
