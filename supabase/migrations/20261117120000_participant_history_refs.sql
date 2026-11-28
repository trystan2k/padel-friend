begin;

-- PAF-231 fix round: retained-history readers never expose the internal tombstone id.
--
-- A withdrawn identity is a stable internal UUID; publishing it would give departed players a
-- cross-match identifier. Every retained-history reader now passes participant ids through
-- privacy_internal.participant_ref(id, scope): a live participant keeps the real id (byte-identical
-- payload), a withdrawn one becomes "former-<16 hex>", a key derived from the tombstone AND the
-- reader scope (game group, league or match). It is stable inside one scope, differs between scopes
-- and between departed players of one scope, and cannot be mapped back or joined across matches.
-- Relationship and leader views drop withdrawn identities instead (no subject-specific views).

create function privacy_internal.participant_ref(p_user_id uuid, p_scope uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_user_id is null then null
    when exists (select 1 from public.participant_identities i where i.id = p_user_id and i.state = 'withdrawn')
      then 'former-' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        p_user_id::text || ':' || coalesce(p_scope::text, ''), 'UTF8')), 'hex'), 1, 16)
    else p_user_id::text end;
$$;

-- Replaces every withdrawn id found anywhere inside a jsonb payload (teams, entries, audit rows).
create function privacy_internal.participant_json_ref(p_json jsonb, p_scope uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_text text; v_id text;
begin
  if p_json is null then return null; end if;
  v_text := p_json::text;
  for v_id in select distinct m[1] from pg_catalog.regexp_matches(v_text,
      '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') as m loop
    if exists (select 1 from public.participant_identities i where i.id = v_id::uuid and i.state = 'withdrawn') then
      v_text := pg_catalog.replace(v_text, v_id, privacy_internal.participant_ref(v_id::uuid, p_scope));
    end if;
  end loop;
  return v_text::jsonb;
end $$;

-- Drops withdrawn ids from per-player relation maps ({partners|opponents|...: {id: counts}}).
create function privacy_internal.relations_without_withdrawn(p_relations jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_object_agg(t.k, case when pg_catalog.jsonb_typeof(t.v) = 'object'
      then (select coalesce(pg_catalog.jsonb_object_agg(e.key, e.value), '{}'::jsonb)
              from pg_catalog.jsonb_each(t.v) e
             where not exists (select 1 from public.participant_identities i
                where i.state = 'withdrawn' and i.id::text = e.key))
      else t.v end), '{}'::jsonb)
    from pg_catalog.jsonb_each(coalesce(p_relations, '{}'::jsonb)) as t(k, v);
$$;

revoke all on function privacy_internal.participant_ref(uuid, uuid),
  privacy_internal.participant_json_ref(jsonb, uuid),
  privacy_internal.relations_without_withdrawn(jsonb) from public, anon, authenticated, service_role;

-- Leader names never carry a withdrawn id; the client renders the former-player placeholder.
create or replace function public.statistics_relationship_name(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('userId',
    case when exists (select 1 from public.participant_identities i where i.id = p_user_id and i.state = 'withdrawn')
      then 'former' else p_user_id::text end,
    'displayName', (select p.display_name from public.player_profiles p where p.user_id = p_user_id));
$$;

do $patch$
declare
  r record; v_oid oid; v_def text; v_new text; v_count integer;
begin
  for r in select * from (values
    ('get_match_event_official_results', $q$'actor_id', c.actor_id,$q$, $q$'actor_id', privacy_internal.participant_ref(c.actor_id, c.proposal_id),$q$, 1),
    ('get_match_event_official_results', $q$'teams', v.teams,$q$, $q$'teams', privacy_internal.participant_json_ref(v.teams, c.proposal_id),$q$, 1),
    ('get_match_event_result_proposals', $q$'user_id', u.value,$q$, $q$'user_id', privacy_internal.participant_ref(u.value::uuid, p.id),$q$, 1),
    ('get_match_event_result_proposals', $q$'submitted_by', v.submitted_by,$q$, $q$'submitted_by', privacy_internal.participant_ref(v.submitted_by, p.id),$q$, 1),
    ('get_match_event_result_proposals', $q$'rejector_id', r.reviewer_user_id,$q$, $q$'rejector_id', privacy_internal.participant_ref(r.reviewer_user_id, p.id),$q$, 1),
    ('get_match_event_result_proposals', $q$'actor_id', c.actor_id$q$, $q$'actor_id', privacy_internal.participant_ref(c.actor_id, p.id)$q$, 1),
    ('get_match_event_result_proposals', $q$'submitted_by', history.submitted_by,$q$, $q$'submitted_by', privacy_internal.participant_ref(history.submitted_by, p.id),$q$, 1),
    ('get_match_event_result_proposals', $q$'reviewer_id', review.reviewer_user_id,$q$, $q$'reviewer_id', privacy_internal.participant_ref(review.reviewer_user_id, p.id),$q$, 1),
    ('get_match_event_result_proposals', $q$'ranked_blocked', ranked.value,$q$, $q$'ranked_blocked', privacy_internal.participant_json_ref(ranked.value, p.id),$q$, 1),
    ('get_match_event_rating_changes', $q$'user_id', e.user_id,$q$, $q$'user_id', privacy_internal.participant_ref(e.user_id, e.game_group_id),$q$, 1),
    ('get_rating_group_explanation', $q$'user_id', c.user_id,$q$, $q$'user_id', privacy_internal.participant_ref(c.user_id, p_game_group_id),$q$, 1),
    ('get_league_standings', $q$'user_id', s.user_id,$q$, $q$'user_id', privacy_internal.participant_ref(s.user_id, v_league.id),$q$, 1),
    ('get_league_standings', $q$'entries', v_snapshot.entries);$q$, $q$'entries', privacy_internal.participant_json_ref(v_snapshot.entries, v_league.id));$q$, 1),
    ('get_league_standings_audit', $q$'actor_id', e.actor_id,$q$, $q$'actor_id', privacy_internal.participant_ref(e.actor_id, e.league_id),$q$, 1),
    ('get_league_counters', $q$'user_id', r.user_id,$q$, $q$'user_id', privacy_internal.participant_ref(r.user_id, v_league.id),$q$, 1),
    ('league_dto', $q$'owner_id', p_league.owner_id,$q$, $q$'owner_id', privacy_internal.participant_ref(p_league.owner_id, p_league.id),$q$, 1),
    ('get_statistics_group_detail', $q$'user_id', u.id,$q$, $q$'user_id', privacy_internal.participant_ref(u.id, g.game_group_id),$q$, 1),
    ('get_statistics_group_detail', $q$'user_id', vv.submitted_by,$q$, $q$'user_id', privacy_internal.participant_ref(vv.submitted_by, g.game_group_id),$q$, 1),
    ('get_statistics_group_detail', $q$'user_id', rv.reviewer_user_id,$q$, $q$'user_id', privacy_internal.participant_ref(rv.reviewer_user_id, g.game_group_id),$q$, 1),
    ('get_statistics_group_detail', $q$'user_id', v_conf.actor_id,$q$, $q$'user_id', privacy_internal.participant_ref(v_conf.actor_id, g.game_group_id),$q$, 2),
    ('list_match_event_management_participants', $q$jsonb_build_object('user_id',r.user_id,$q$, $q$jsonb_build_object('user_id',privacy_internal.participant_ref(r.user_id, r.match_event_id),$q$, 1),
    ('list_match_event_registration_requests', $q$'user_id', r.user_id,$q$, $q$'user_id', privacy_internal.participant_ref(r.user_id, r.match_event_id),$q$, 1),
    ('get_match_event_management', $q$'owner_id',e.created_by,$q$, $q$'owner_id',privacy_internal.participant_ref(e.created_by, e.id),$q$, 1),
    ('list_match_event_audit', $q$select to_jsonb(a) from$q$, $q$select privacy_internal.participant_json_ref(to_jsonb(a), a.match_event_id) from$q$, 1),
    ('list_match_event_invitations', $q$'invitee_user_id', i.invitee_user_id,$q$, $q$'invitee_user_id', privacy_internal.participant_ref(i.invitee_user_id, i.match_event_id),$q$, 1),
    ('result_amendment_dto', $q$'submitted_by', v.submitted_by,$q$, $q$'submitted_by', privacy_internal.participant_ref(v.submitted_by, r.proposal_id),$q$, 1),
    ('result_amendment_dto', $q$'teams', v.teams,$q$, $q$'teams', privacy_internal.participant_json_ref(v.teams, r.proposal_id),$q$, 1),
    ('result_amendment_dto', $q$'rejector_id', rv.reviewer_user_id,$q$, $q$'rejector_id', privacy_internal.participant_ref(rv.reviewer_user_id, r.proposal_id),$q$, 1),
    ('result_amendment_dto', $q$'requester_id', r.requester_id,$q$, $q$'requester_id', privacy_internal.participant_ref(r.requester_id, r.proposal_id),$q$, 1),
    ('result_amendment_dto', $q$'actor_id', r.decision_actor_id,$q$, $q$'actor_id', privacy_internal.participant_ref(r.decision_actor_id, r.proposal_id),$q$, 1),
    ('result_dispute_resolution_dto', $q$'actor_id', x.actor_id,$q$, $q$'actor_id', privacy_internal.participant_ref(x.actor_id, x.proposal_id),$q$, 1),
    ('get_community_statistics', $q$coalesce(public.statistics_json_sum(q.relations), '{}'::jsonb) as relations,$q$, $q$privacy_internal.relations_without_withdrawn(coalesce(public.statistics_json_sum(q.relations), '{}'::jsonb)) as relations,$q$, 1),
    ('statistics_community_top', $q$from pg_catalog.jsonb_array_elements(p_rows) x$q$, $q$from pg_catalog.jsonb_array_elements(p_rows) x
     where not exists (select 1 from public.participant_identities i where i.state = 'withdrawn' and i.id::text = x ->> 'id')$q$, 1),
    ('statistics_relationship_relations', $q$select coalesce(public.statistics_json_sum(r.relations), '{}'::jsonb) from ($q$, $q$select privacy_internal.relations_without_withdrawn(coalesce(public.statistics_json_sum(r.relations), '{}'::jsonb)) from ($q$, 1)
  ) as t(fn, old_text, new_text, expected) loop
    select p.oid into v_oid from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = r.fn;
    v_def := pg_catalog.pg_get_functiondef(v_oid);
    v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, r.old_text, ''))) / pg_catalog.length(r.old_text);
    if v_count <> r.expected then
      raise exception 'Cannot patch %: expected % occurrence(s) of %, found %', r.fn, r.expected, r.old_text, v_count;
    end if;
    v_new := pg_catalog.replace(v_def, r.old_text, r.new_text);
    execute v_new;
  end loop;
end $patch$;

commit;
