begin;

-- PAF-10 review F2 (round 2): the source prelock (20261101151000) snapshots the eligible,
-- unledgered groups BEFORE the app-wide rating lock. A confirmation can commit between that
-- snapshot and the lock acquisition; its newly eligible group would then be outside the
-- prelocked set, and the evidence inserts made under the rating lock would take key shares
-- on its event row while a queued retry holds that event FOR UPDATE and waits for the rating
-- lock: the original deadlock.
--
-- Protocol: prelock, take the rating lock, re-read. If an eligible unledgered group is not
-- in the prelocked set, give the rating lock back, prelock the full current set and retry
-- (bounded). The lock is a transaction-level advisory lock, which cannot be unlocked
-- directly, but one taken inside a plpgsql EXCEPTION block lives in a subtransaction and is
-- released the moment that subtransaction rolls back.
--
-- Why a covered set stays covered: a confirmation only becomes visible after its finalizer
-- has passed the projector, which needs the rating lock, and the finalizer holds that lock
-- to commit. So while we hold the lock, no other transaction can add an eligible group.
-- Groups created by the caller's OWN confirmation are visible to it and are part of the
-- snapshot; their source rows are also locked by the caller itself, which never conflicts
-- with itself. Groups other transactions committed earlier are already ledgered by their
-- projector (active mode) and excluded by the "unledgered" filter; only the post-activation
-- backfill leaves unledgered groups, and those are exactly what the re-read covers.

create function public.rating_projection_lock_covered() returns void
language plpgsql security definer set search_path = '' as $$
declare
  c_max_attempts constant integer := 8;
  v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    perform public.rating_projection_prelock_sources();
    begin
      perform public.lock_global_rating_projection();
      if not exists (
        select 1 from public.rating_projection_eligible_groups() g
         where not exists (select 1 from public.player_rating_events e where e.game_group_id = g.game_group_id)
           and not exists (select 1 from pg_temp.rating_prelock_groups t where t.game_group_id = g.game_group_id)
      ) then
        return;
      end if;
      raise exception using errcode = 'RT001', message = 'RATING_PRELOCK_GAP';
    exception when sqlstate 'RT001' then
      -- Subtransaction rolled back: the rating lock is released. Re-snapshot and retry.
      if v_attempt >= c_max_attempts then
        raise exception using errcode = '55P03', message = 'RATING_ACTIVATION_CONTENDED';
      end if;
    end;
  end loop;
end $$;
revoke all on function public.rating_projection_lock_covered() from public, anon, authenticated, service_role;

do $locks$
declare v_definition text; v_updated text;
begin
  v_definition := pg_catalog.pg_get_functiondef('public.project_confirmed_rating_group(uuid)'::regprocedure);
  v_updated := pg_catalog.replace(v_definition,
    E'    perform public.rating_projection_prelock_sources();\n  end if;\n  perform public.lock_global_rating_projection();',
    E'    perform public.rating_projection_lock_covered();\n  else\n    perform public.lock_global_rating_projection();\n  end if;');
  if v_updated = v_definition then
    raise exception 'Unexpected project_confirmed_rating_group definition; refusing to patch its lock protocol';
  end if;
  execute v_updated;

  v_definition := pg_catalog.pg_get_functiondef('public.activate_global_rating_projection()'::regprocedure);
  v_updated := pg_catalog.replace(v_definition,
    E'  perform public.rating_projection_prelock_sources();\n  perform public.lock_global_rating_projection();',
    E'  perform public.rating_projection_lock_covered();');
  if v_updated = v_definition then
    raise exception 'Unexpected activate_global_rating_projection definition; refusing to patch its lock protocol';
  end if;
  execute v_updated;
end $locks$;

commit;
