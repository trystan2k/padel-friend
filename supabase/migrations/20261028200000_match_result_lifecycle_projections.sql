begin;

-- T08.4: expose one caller's authoritative lifecycle capabilities and a
-- confirmation-backed summary derived from the roster frozen for results.
create function public.match_event_result_summary(p_match_event_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with roster as (
    select
      coalesce(bool_or(s.results_protected_at is not null), false) as is_frozen,
      count(*) filter (
        where r.lifecycle = 'accepted'
          and r.cancelled_at is null
          and r.participation_status = 'playing'
      )::integer as playing_count
    from public.match_event_registration_state s
    left join public.match_event_registrations r
      on r.match_event_id = s.match_event_id
    where s.match_event_id = p_match_event_id
  ), expected as (
    select is_frozen, case when is_frozen then playing_count / 4 else 0 end as group_count
      from roster
  ), facts as (
    select
      count(*) filter (where p.status = 'pending')::integer as pending_count,
      count(*) filter (where p.status = 'disputed')::integer as disputed_count
    from expected x
    left join public.match_event_result_proposals p
      on p.match_event_id = p_match_event_id
     and p.group_number between 1 and x.group_count
  ), confirmed as (
    select
      count(c.id)::integer as confirmed_count,
      count(*) filter (where v.classification = 'incomplete')::integer as incomplete_count
    from expected x
    left join public.match_event_result_confirmations c
      on c.match_event_id = p_match_event_id
     and c.group_number between 1 and x.group_count
    left join public.match_event_result_proposal_versions v
      on v.proposal_id = c.proposal_id and v.version = c.proposal_version
  )
  select pg_catalog.jsonb_build_object(
    'expected_group_count', x.group_count,
    'confirmed_group_count', c.confirmed_count,
    'pending_group_count', f.pending_count,
    'disputed_group_count', f.disputed_count,
    'unsubmitted_group_count', greatest(x.group_count - c.confirmed_count - f.pending_count - f.disputed_count, 0),
    'incomplete_result_group_count', c.incomplete_count,
    'results_roster_frozen', x.is_frozen,
    'result_resolution', case
      when x.group_count > 0 and c.confirmed_count = x.group_count then 'completed'
      when c.confirmed_count > 0 then 'partially_resolved'
      else 'awaiting_results'
    end
  )
  from expected x cross join facts f cross join confirmed c;
$$;
revoke all on function public.match_event_result_summary(uuid) from public, anon, authenticated;

create or replace function public.get_match_event_result_proposals(p_match_event_id uuid)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  e public.match_events%rowtype;
  caller_id uuid := auth.uid();
begin
  if caller_id is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    raise exception 'MATCH_RESULT_UNAUTHENTICATED' using errcode = '28000';
  end if;
  select * into e from public.match_events where id = p_match_event_id;
  if e.id is null then raise exception 'MATCH_RESULT_NOT_FOUND' using errcode = 'P0001'; end if;
  if e.created_by <> caller_id and not public.is_community_admin(e.community_id)
    and not exists (
      select 1 from public.match_event_registrations r
       where r.match_event_id = e.id and r.user_id = caller_id
         and r.lifecycle = 'accepted' and r.cancelled_at is null
    ) then
    raise exception 'MATCH_RESULT_FORBIDDEN' using errcode = '42501';
  end if;

  return query
  select pg_catalog.jsonb_build_object(
    'event_id', p.match_event_id,
    'proposal_id', p.id,
    'group_number', p.group_number,
    'status', p.status,
    'version', v.version,
    'teams', (
      select pg_catalog.jsonb_object_agg(side, players)
        from (
          select side, (
            select pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object('user_id', u.value, 'display_name', profile.display_name)
              order by u.ordinality
            )
              from pg_catalog.jsonb_array_elements_text(v.teams -> side)
                with ordinality u(value, ordinality)
              left join public.player_profiles profile on profile.user_id = u.value::uuid
          ) as players
            from pg_catalog.unnest(array['team_a', 'team_b']) side
        ) named
    ),
    'sets', v.sets,
    'classification', v.classification,
    'played_at_utc', v.played_at_utc,
    'played_at_local', pg_catalog.to_char(v.played_at_local, 'YYYY-MM-DD HH24:MI:SS'),
    'played_at_offset_seconds', v.played_at_offset_seconds,
    'court_label', v.court_label,
    'submitted_by', v.submitted_by,
    'submitted_by_name', (select profile.display_name from public.player_profiles profile where profile.user_id = v.submitted_by),
    'submitted_at', v.submitted_at,
    'review_deadline_at', v.review_deadline_at,
    'rating_effective', e.event_type = 'competitive' and v.classification <> 'incomplete',
    'can_approve', p.status = 'pending'
      and clock_timestamp() < v.review_deadline_at
      and caller_id <> v.submitted_by
      and (v.teams -> 'team_a' ? caller_id::text or v.teams -> 'team_b' ? caller_id::text)
      and case
        when v.teams -> 'team_a' ? v.submitted_by::text then v.teams -> 'team_b' ? caller_id::text
        when v.teams -> 'team_b' ? v.submitted_by::text then v.teams -> 'team_a' ? caller_id::text
        else true
      end
      and not exists (
        select 1 from public.match_event_result_reviews r
         where r.proposal_id = p.id and r.proposal_version = v.version
           and r.reviewer_user_id = caller_id and r.decision = 'approve'
      ),
    'can_reject', p.status = 'pending'
      and clock_timestamp() < v.review_deadline_at
      and caller_id <> v.submitted_by
      and (v.teams -> 'team_a' ? caller_id::text or v.teams -> 'team_b' ? caller_id::text),
    'can_correct', (caller_id = e.created_by or public.is_community_admin(e.community_id))
      and p.status in ('pending', 'disputed')
      and (p.status = 'disputed' or clock_timestamp() < v.review_deadline_at),
    'caller_decision', (
      select r.decision from public.match_event_result_reviews r
       where r.proposal_id = p.id and r.proposal_version = v.version
         and r.reviewer_user_id = caller_id
       order by r.decided_at desc, r.id desc limit 1
    ),
    'required_team_coverage_count', case
      when v.teams -> 'team_a' ? v.submitted_by::text or v.teams -> 'team_b' ? v.submitted_by::text then 1
      else 2
    end,
    'received_team_coverage_count', case
      when v.teams -> 'team_a' ? v.submitted_by::text then least(coverage.team_b_approval_count, 1)
      when v.teams -> 'team_b' ? v.submitted_by::text then least(coverage.team_a_approval_count, 1)
      else (case when coverage.team_a_approval_count > 0 then 1 else 0 end)
         + (case when coverage.team_b_approval_count > 0 then 1 else 0 end)
    end,
    'team_a_approval_count', coverage.team_a_approval_count,
    'team_b_approval_count', coverage.team_b_approval_count,
    'dispute_evidence', case when p.status = 'disputed' then (
      select pg_catalog.jsonb_build_object(
        'rejector_id', r.reviewer_user_id,
        'rejector_name', profile.display_name,
        'reason_code', r.reason_code,
        'reason_note', r.reason_note,
        'decided_at', r.decided_at
      )
        from public.match_event_result_reviews r
        left join public.player_profiles profile on profile.user_id = r.reviewer_user_id
       where r.proposal_id = p.id and r.proposal_version = v.version and r.decision = 'reject'
       order by r.decided_at desc, r.id desc limit 1
    ) else null end,
    'confirmation', case when c.id is null then null else pg_catalog.jsonb_build_object(
      'confirmation_id', c.id,
      'source', c.source,
      'confirmed_at', c.confirmed_at,
      'effective_at', c.effective_at,
      'actor_id', c.actor_id
    ) end,
    'version_timeline', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'version', history.version,
        'status', case when history.version = p.active_version then p.status else 'superseded' end,
        'submitted_by', history.submitted_by,
        'submitted_by_name', (select profile.display_name from public.player_profiles profile where profile.user_id = history.submitted_by),
        'submitted_at', history.submitted_at,
        'review_deadline_at', history.review_deadline_at,
        'decisions', (
          select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'reviewer_id', review.reviewer_user_id,
            'reviewer_name', reviewer.display_name,
            'decision', review.decision,
            'reason_code', review.reason_code,
            'reason_note', review.reason_note,
            'decided_at', review.decided_at
          ) order by review.decided_at, review.id), '[]'::jsonb)
            from public.match_event_result_reviews review
            left join public.player_profiles reviewer on reviewer.user_id = review.reviewer_user_id
           where review.proposal_id = p.id and review.proposal_version = history.version
        ),
        'confirmation_id', (
          select confirmation.id from public.match_event_result_confirmations confirmation
           where confirmation.proposal_id = p.id and confirmation.proposal_version = history.version
        )
      ) order by history.version), '[]'::jsonb)
        from public.match_event_result_proposal_versions history
       where history.proposal_id = p.id
    )
  )
  from public.match_event_result_proposals p
  join public.match_event_result_proposal_versions v
    on v.proposal_id = p.id and v.version = p.active_version
  left join public.match_event_result_confirmations c
    on c.proposal_id = p.id and c.proposal_version = v.version
  cross join lateral (
    select
      count(distinct r.reviewer_user_id) filter (where v.teams -> 'team_a' ? r.reviewer_user_id::text)::integer as team_a_approval_count,
      count(distinct r.reviewer_user_id) filter (where v.teams -> 'team_b' ? r.reviewer_user_id::text)::integer as team_b_approval_count
      from public.match_event_result_reviews r
     where r.proposal_id = p.id and r.proposal_version = v.version and r.decision = 'approve'
       and r.reviewer_user_id <> v.submitted_by
  ) coverage
  where p.match_event_id = e.id
  order by p.group_number;
end $$;

-- Extend authorized event list/detail payloads without changing their existing
-- open/cancelled operational status or reader predicates.
do $$
declare
  definition text;
  signature text;
begin
  foreach signature in array array[
    'public.get_match_event(uuid)',
    'public.list_match_events(text,uuid,text,integer,timestamptz)'
  ] loop
    definition := pg_catalog.pg_get_functiondef(signature::regprocedure);
    if position('''result_summary''' in definition) = 0 then
      definition := replace(definition, '''as_of'',s.as_of',
        '''result_summary'',public.match_event_result_summary(e.id),''as_of'',s.as_of');
      definition := replace(definition, '''as_of'',e.as_of',
        '''result_summary'',public.match_event_result_summary(e.id),''as_of'',e.as_of');
      if position('''result_summary''' in definition) = 0 then
        raise exception 'Could not add result summary to %', signature;
      end if;
      execute definition;
    end if;
  end loop;
end $$;

revoke all on function public.get_match_event_result_proposals(uuid) from public, anon, authenticated;
grant execute on function public.get_match_event_result_proposals(uuid) to authenticated;

commit;
