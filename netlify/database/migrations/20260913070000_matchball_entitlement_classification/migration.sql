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
    AND lower(concat_ws(' ', right_item.name, right_item.description)) ~ 'match[ -]?ball'
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

COMMENT ON FUNCTION enforce_event_package_allocation() IS
  'Allows only explicit matchball rights. Generic mentions of matches or home games are not event matchball entitlements.';
