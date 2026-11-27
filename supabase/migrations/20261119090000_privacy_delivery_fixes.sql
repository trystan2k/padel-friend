begin;

-- PAF-199 fix round (unit F findings).
--   1. Membership-derived projections: the statistics rebuild after an erasure now covers EVERY community
--      where the subject has membership, league counters, participant facts or league positions, not only
--      communities reached through event registrations. The plan impact reports the rebuild scope.
--   2. Awaiting-identity erasure: an automated, service-role-only surface for people who exist only as
--      an add-by-email operation (no Auth user).
--   3. Stale-token boundary: public.is_actor_live() lets the protected server boundary treat an erased or
--      frozen subject as signed out with one indexed lookup.

-- 1. Rebuild scope ----------------------------------------------------------------------------------
create function privacy_internal.erasure_subject_communities(p_subject uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array(select x from (
      select m.community_id x from public.community_members m where m.user_id = p_subject
      union select c.id from public.communities c where c.created_by = p_subject
      union select e.community_id from public.match_events e where e.created_by = p_subject
      union select e.community_id from public.match_events e
        join public.match_event_registrations rg on rg.match_event_id = e.id and rg.user_id = p_subject
      union select l.community_id from public.leagues l where l.owner_id = p_subject
      union select k.community_id from public.league_player_counters k where k.user_id = p_subject
      union select pf.community_id from public.statistics_participant_facts pf where pf.user_id = p_subject
      union select lp.community_id from public.statistics_league_positions lp where lp.player_id = p_subject) q
    order by x), '{}'::uuid[]);
$$;
revoke all on function privacy_internal.erasure_subject_communities(uuid) from public, anon, authenticated, service_role;

do $patch$
declare
  r record; v_oid oid; v_def text; v_new text; v_count integer;
begin
  for r in select * from (values
    ('account_erasure_execute', $q$      union select l.community_id from public.leagues l where l.owner_id = p_subject) q order by x);$q$,
      $q$      union select l.community_id from public.leagues l where l.owner_id = p_subject
      union select k.community_id from public.league_player_counters k where k.user_id = p_subject
      union select pf.community_id from public.statistics_participant_facts pf where pf.user_id = p_subject
      union select lp.community_id from public.statistics_league_positions lp where lp.player_id = p_subject) q order by x);$q$, 1),
    ('account_erasure_execute', $q$  for v_id in select distinct e.community_id from public.match_events e where e.id = any (v_events) order by 1 loop
    perform public.rebuild_statistics(v_id);
  end loop;$q$, $q$  -- Every community the subject touched (membership, counters, facts, positions), not only event rosters.
  foreach v_id in array v_communities loop
    perform public.rebuild_statistics(v_id);
  end loop;$q$, 1),
    ('account_erasure_plan', $q$    'email_operations', (select pg_catalog.count(*) from public.match_player_add_operations o$q$,
      $q$    'rebuild_communities', pg_catalog.cardinality(privacy_internal.erasure_subject_communities(p_subject)),
    'email_operations', (select pg_catalog.count(*) from public.match_player_add_operations o$q$, 1)
  ) as t(fn, old_text, new_text, expected) loop
    select p.oid into v_oid from pg_catalog.pg_proc p where p.pronamespace = 'privacy_internal'::regnamespace and p.proname = r.fn;
    v_def := pg_catalog.pg_get_functiondef(v_oid);
    v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, r.old_text, ''))) / pg_catalog.length(r.old_text);
    if v_count <> r.expected then
      raise exception 'Cannot patch %: expected % occurrence(s), found % of [%]', r.fn, r.expected, v_count, pg_catalog.left(r.old_text, 60);
    end if;
    execute pg_catalog.replace(v_def, r.old_text, r.new_text);
  end loop;
end $patch$;

-- 2. Awaiting-identity erasure -----------------------------------------------------------------------
-- Scope: match_player_add_operations in state awaiting_identity whose email matches EXACTLY. A person with
-- an Auth user goes through the normal case flow (refused here). The address is read under the same
-- per-email advisory lock the sign-up completion trigger takes, so a concurrent identity creation and this
-- erasure serialize. Scrubbed rows keep only non-identifying facts (event, actor, request id, timing); the
-- capability and digest rows are removed and the dispatch attempt is cleared, so no queued or in-flight
-- dispatch can create the identity (the redrive claim needs a real address and an eligible dispatch state).
-- No suppression list: a later, fresh invitation of the same address is a new operation.
create function privacy_internal.erase_unclaimed_identity(p_email text, p_apply boolean, p_all_matches boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_digest bytea; v_ops uuid[]; v_sends bigint; v_hits bigint;
begin
  if pg_catalog.char_length(v_email) not between 3 and 254 or pg_catalog.strpos(v_email, '@') = 0 then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'EMAIL_INVALID');
  end if;
  perform public.lock_match_player_add_email(v_email);
  if exists (select 1 from auth.users u where pg_catalog.lower(u.email) = v_email) then
    return pg_catalog.jsonb_build_object('status', 'refused', 'code', 'ACCOUNT_EXISTS');
  end if;
  v_digest := public.match_player_add_digest(v_email);
  perform 1 from public.match_player_add_operations o
    where o.email = v_email and o.state = 'awaiting_identity' order by o.id for update;
  v_ops := array(select o.id from public.match_player_add_operations o
    where o.email = v_email and o.state = 'awaiting_identity' order by o.id);
  select pg_catalog.count(*) into v_sends from public.match_player_add_recipient_sends s where s.email_digest = v_digest;
  select pg_catalog.count(*) into v_hits from public.match_player_add_throttle_hits h where h.email_digest = v_digest;
  if pg_catalog.cardinality(v_ops) > 1 and not p_all_matches then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'AMBIGUOUS',
      'operations', pg_catalog.cardinality(v_ops));
  end if;
  if p_apply then
    update public.match_player_add_operations set email = 'redacted', display_name = 'redacted',
        capability_hash = null, capability_expires_at = null, dispatch_state = 'suppressed',
        email_eligible = false, dispatch_attempt = null
      where id = any (v_ops);
    delete from public.match_player_add_recipient_sends s where s.email_digest = v_digest;
    delete from public.match_player_add_throttle_hits h where h.email_digest = v_digest;
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'applied', p_apply,
    'operations', pg_catalog.cardinality(v_ops), 'recipient_sends', v_sends, 'throttle_hits', v_hits);
end $$;

create function public.privacy_op_erase_unclaimed(p_email text, p_confirm boolean, p_all_matches boolean default false)
returns jsonb language sql security definer set search_path = '' as $$
  select privacy_internal.erase_unclaimed_identity(p_email, p_confirm is not distinct from true,
    p_all_matches is not distinct from true);
$$;
revoke all on function privacy_internal.erase_unclaimed_identity(text, boolean, boolean),
  public.privacy_op_erase_unclaimed(text, boolean, boolean) from public, anon, authenticated, service_role;
grant execute on function public.privacy_op_erase_unclaimed(text, boolean, boolean) to service_role;

-- 3. Stale-token boundary ------------------------------------------------------------------------------
-- A signature-valid JWT of an erased (no live anchor) or frozen subject resolves as signed out. Invoker
-- function: it only exposes the boolean the existing definer predicate already computes.
grant execute on function privacy_internal.account_actor_blocked() to authenticated;
create function public.is_actor_live() returns boolean
language sql stable set search_path = '' as $$
  select (select auth.uid()) is not null and not privacy_internal.account_actor_blocked();
$$;
revoke all on function public.is_actor_live() from public, anon, authenticated, service_role;
grant execute on function public.is_actor_live() to authenticated;

commit;
