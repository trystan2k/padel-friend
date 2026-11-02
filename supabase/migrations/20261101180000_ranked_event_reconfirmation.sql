begin;

-- PAF-11 / U3: Ranked / League changes join the existing major-edit consent protocol.
--
-- Contract (docs/plan/Plan PAF-11 T11, "Consent", "Period changes", C0 decisions):
--   * edit_match_event accepts `league_id` (null = Unranked). Rank flips, League-ID switches and
--     (already) schedule changes are MAJOR: reconfirmation_generation advances ONCE per effective
--     edit, registrations AND current attempts carry the new required generation atomically, and
--     the audit row stores before/after competition impact (status, League name, window).
--   * The merged state (starts_at + event_type + league_id) is validated in ONE statement chain:
--     an outside-period merge, an unavailable/closed target League, a Friendly merge that keeps a
--     League, or a Ranked switch with accepted nonmembers is rejected with a typed error BEFORE any
--     write, so the whole edit is atomic. Nothing ever rebinds or downgrades automatically; the
--     organizer repairs explicitly (reschedule inside the window, or send league_id = null).
--   * AC13 decision (documented): PROVISIONAL accepted players cannot reconfirm (no session), so
--     on every major edit their required AND confirmed generation advance together with their
--     attempt evidence. They keep accepted_order/current attempt/accepted_at/capacity, receive no
--     reconfirmation notification and no counterfeit reconfirmed_at, and each carry is audited as
--     `reconfirmation_carried` with the sanitized reason `provisional_system_carry`. Provisional
--     status is read at edit time: a player who claimed the account earlier is registered and
--     reconfirms normally; claiming later adds no consent debt and resets no counter.
--   * Pending nonmember invites/requests are not mutated. The U2 gate (submit/approve/accept
--     re-check CURRENT membership of Ranked events) makes them non-actionable under the event lock.
--   * guard_match_event_mutation lets league_id change only inside edit_match_event (transaction
--     local marker); the League trigger stays the data-level floor for every other path.

-- 1. Audit action for the system carry.
alter table public.match_event_audit_log drop constraint match_event_audit_log_action_check;
alter table public.match_event_audit_log add constraint match_event_audit_log_action_check
  check (action = any (array['withdraw','remove','transfer','cancel','minor_edit','major_edit','reconfirm',
    'reconfirmation_excluded','reconfirmation_carried','result_approved','result_disputed','result_corrected',
    'result_confirmed','player_added','player_claimed']));

-- 2. Effective League window: fixed end, or the audited close instant of a Manual League.
create function public.match_league_effective_end(p_end_at timestamptz, p_closed_at timestamptz)
returns timestamptz language sql immutable set search_path = '' as $$
  select coalesce(p_end_at, p_closed_at);
$$;

create or replace function public.assert_match_league_window(p_league_id uuid, p_community_id uuid, p_starts_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_league public.leagues%rowtype;
begin
  select * into v_league from public.leagues l where l.id = p_league_id and l.community_id = p_community_id for share;
  if not found or p_starts_at < v_league.start_at
    or (public.match_league_effective_end(v_league.end_at, v_league.closed_at) is not null
      and p_starts_at > public.match_league_effective_end(v_league.end_at, v_league.closed_at)) then
    raise exception using errcode = 'P0001', message = 'MATCH_LEAGUE_OUT_OF_PERIOD';
  end if;
end $$;

-- Competition impact snapshot used by audit evidence and the consent summary.
create function public.match_competition_impact(p_league_id uuid, p_event_type public.match_event_type)
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'competition_status', case when p_event_type = 'competitive'
      then case when p_league_id is null then 'unranked' else 'ranked' end end,
    'league_id', p_league_id,
    'league_name', l.name,
    'league_start_at', public.league_utc_text(l.start_at),
    'league_end_at', public.league_utc_text(public.match_league_effective_end(l.end_at, l.closed_at)),
    'league_timezone', l.timezone)
  from (select 1) one left join public.leagues l on l.id = p_league_id;
$$;

-- 3. Merged-state validation for the edit path. Caller holds the canonical community/event locks.
create function public.assert_match_league_edit_locked(p_event_id uuid, p_community_id uuid,
  p_published_at timestamptz, p_current_league_id uuid, p_league_id uuid, p_starts_at timestamptz,
  p_event_type public.match_event_type) returns void
language plpgsql security definer set search_path = '' as $$
declare v_league public.leagues%rowtype; v_changed boolean := p_league_id is distinct from p_current_league_id;
  v_end timestamptz;
begin
  if p_league_id is null then return; end if;
  if p_event_type <> 'competitive' then
    raise exception 'MATCH_MANAGEMENT_LEAGUE_FRIENDLY' using errcode = 'P0001';
  end if;
  select * into v_league from public.leagues l where l.id = p_league_id and l.community_id = p_community_id for share;
  -- Unknown, cross-community and later-created Leagues are indistinguishable (no retroactive binding).
  if not found or (v_changed and v_league.created_at > p_published_at) then
    raise exception 'MATCH_MANAGEMENT_LEAGUE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  -- A closed League stays a valid historical association; it cannot be newly selected.
  if v_changed and v_league.status = 'closed' then
    raise exception 'MATCH_MANAGEMENT_LEAGUE_CLOSED' using errcode = 'P0001';
  end if;
  v_end := public.match_league_effective_end(v_league.end_at, v_league.closed_at);
  if p_starts_at < v_league.start_at or (v_end is not null and p_starts_at > v_end) then
    raise exception 'MATCH_MANAGEMENT_LEAGUE_OUT_OF_PERIOD' using errcode = 'P0001',
      detail = pg_catalog.jsonb_build_object('league', public.match_competition_impact(p_league_id, p_event_type))::text;
  end if;
  if v_changed and exists(select 1 from public.match_event_registrations r
    where r.match_event_id = p_event_id and r.lifecycle = 'accepted' and r.cancelled_at is null
      and not public.match_registration_is_member(p_community_id, r.user_id)) then
    raise exception 'MATCH_MANAGEMENT_RANKED_NONMEMBERS_ACCEPTED' using errcode = 'P0001',
      detail = pg_catalog.jsonb_build_object('accepted_nonmember_count', (select count(*)
        from public.match_event_registrations r where r.match_event_id = p_event_id and r.lifecycle = 'accepted'
          and r.cancelled_at is null and not public.match_registration_is_member(p_community_id, r.user_id)))::text;
  end if;
end $$;

-- 4. Mutation floor: league_id may only change inside edit_match_event; the League trigger then
-- re-validates the binding with the publication-time anchor for any change.
create or replace function public.guard_match_event_mutation() returns trigger
language plpgsql security definer set search_path='' as $$
declare allowed text[]:=array['created_by','version','updated_at','status','cancelled_at','cancelled_by','cancel_reason',
  'venue_name','maps_url','court_notes','price_minor','currency','payment_note','notes',
  'maximum_registrations','registration_cutoff_at','saved_venue_id','starts_at','event_type','reconfirmation_generation'];
begin
  if tg_op='DELETE' then raise exception 'Match history is immutable' using errcode='23514'; end if;
  if pg_catalog.current_setting('app.edit_match_league_id', true) is not distinct from old.id::text then
    allowed:=allowed||array['league_id'];
  end if;
  if (to_jsonb(new)-allowed) is distinct from (to_jsonb(old)-allowed)
    or old.status='cancelled' or new.version<>old.version+1 then
    raise exception 'Invalid match event mutation' using errcode='23514';
  end if;
  return new;
end $$;

create or replace function public.guard_match_event_league_binding() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.assert_match_league_binding(new.community_id, new.league_id, new.starts_at,
      new.event_type, new.published_at);
  elsif new.league_id is distinct from old.league_id then
    perform public.assert_match_league_binding(new.community_id, new.league_id, new.starts_at,
      new.event_type, old.published_at);
  elsif new.league_id is not null then
    if new.event_type <> 'competitive' then
      raise exception using errcode = 'P0001', message = 'MATCH_LEAGUE_FRIENDLY_NOT_ALLOWED';
    end if;
    if new.starts_at is distinct from old.starts_at then
      perform public.assert_match_league_window(new.league_id, new.community_id, new.starts_at);
    end if;
  end if;
  return new;
end $$;

-- 5. edit_match_event with Ranked/League facts and provisional carry.
create or replace function public.edit_match_event(p_match_event_id uuid,p_expected_version bigint,p_patch jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=auth.uid(); e public.match_events%rowtype; merged public.match_events%rowtype;
  t timestamptz; rev bigint; recipient uuid; k text; v jsonb; payload jsonb; result jsonb;
  major boolean; before_roster jsonb; generation bigint; fields text[]; before_data jsonb; after_data jsonb;
  cmd public.match_event_management_commands%rowtype; carried uuid[]:='{}'::uuid[];
  allowed text[]:=array['venue_name','maps_url','court_notes','price_minor','currency','payment_note','notes',
    'maximum_registrations','registration_cutoff_at','event_type','starts_at','league_id'];
begin perform public.assert_actor_not_provisional();
  if a is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_request_id is null or p_expected_version is null or p_expected_version not between 1 and 9007199254740991
    or p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'Invalid edit' using errcode='22023'; end if;
  begin
    e:=public.lock_match_event_registration(p_match_event_id); perform public.assert_match_management_action_locked(p_match_event_id,'edit');
  exception when raise_exception then
    if sqlerrm='MATCH_REGISTRATION_EVENT_NOT_FOUND' then raise exception 'MATCH_MANAGEMENT_NOT_FOUND' using errcode='P0001'; end if;
    raise;
  end;
  perform 1 from public.match_event_registrations where match_event_id=e.id order by id for update;
  perform 1 from public.match_event_registration_attempts where match_event_id=e.id order by id for update;
  perform 1 from public.match_event_invites where match_event_id=e.id order by id for update;
  t:=clock_timestamp();
  if e.created_by<>a then raise exception 'Organizer required' using errcode='42501'; end if;
  perform public.assert_match_event_active_locked(e.id);
  if t>=e.registration_cutoff_at or exists(select 1 from public.match_event_registration_state
    where match_event_id=e.id and cutoff_processed_at is not null) then
    raise exception 'MATCH_MANAGEMENT_CLOSED' using errcode='P0001';
  end if;
  -- Validate types before jsonb_populate_record can coerce strings into numbers/text.
  for k,v in select key,value from jsonb_each(p_patch) loop
    if not k=any(allowed) then raise exception 'Field is not editable: %',k using errcode='22023'; end if;
    if v='null'::jsonb then
      if k in ('venue_name','maps_url','registration_cutoff_at','event_type','starts_at') then raise exception 'Nonnullable edit field' using errcode='22023'; end if;
    elsif k in ('price_minor','maximum_registrations') then
      if jsonb_typeof(v)<>'number' or v::text !~ '^\d+$' or (v::text)::numeric>9007199254740991
        or (k='maximum_registrations' and ((v::text)::numeric<1 or (v::text)::numeric>2147483647)) then
        raise exception 'Invalid edit integer' using errcode='22023'; end if;
    elsif jsonb_typeof(v)<>'string' then raise exception 'Invalid edit text' using errcode='22023';
    elsif k='league_id' then
      if not pg_catalog.pg_input_is_valid(p_patch->>k,'uuid') then raise exception 'Invalid edit league' using errcode='22023'; end if;
      -- Canonical lowercase keeps retried payloads equal.
      p_patch:=jsonb_set(p_patch,array[k],to_jsonb(((p_patch->>k)::uuid)::text));
    elsif k in ('registration_cutoff_at','starts_at') then
      if (p_patch->>k) !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,3})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$' then
        raise exception 'Invalid edit instant' using errcode='22023'; end if;
      begin
        -- Canonical UTC serialization makes offset-equivalent retry payloads equal.
        p_patch:=jsonb_set(p_patch,array[k],to_jsonb(to_char((p_patch->>k)::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
      exception when datetime_field_overflow or invalid_datetime_format then
        raise exception 'Invalid edit instant' using errcode='22023';
      end;
    end if;
  end loop;
  payload:=jsonb_build_object('expected_version',p_expected_version,'patch',p_patch);
  select * into cmd from public.match_event_management_commands where match_event_id=e.id and actor_id=a and request_id=p_request_id;
  if found then
    if cmd.action<>'edit' or cmd.payload<>payload then raise exception 'MATCH_MANAGEMENT_IDEMPOTENCY_CONFLICT' using errcode='P0001'; end if;
    return cmd.result||jsonb_build_object('replayed',true);
  end if;
  if e.version<>p_expected_version then raise exception 'MATCH_MANAGEMENT_VERSION_CONFLICT' using errcode='P0001',detail=jsonb_build_object('current_version',e.version)::text; end if;
  merged:=jsonb_populate_record(e,p_patch);
  -- Explicit pair check closes SQL CHECK's UNKNOWN/null loophole.
  if (merged.price_minor is null)<>(merged.currency is null)
    or (merged.currency is not null and merged.currency not in ('BRL','USD','EUR')) then
    raise exception 'Invalid price/currency pair' using errcode='22023'; end if;
  if merged.starts_at<=t or merged.registration_cutoff_at<=t or merged.registration_cutoff_at>=merged.starts_at then
    raise exception 'Invalid future cutoff' using errcode='22023'; end if;
  if merged.maximum_registrations is not null and merged.maximum_registrations<(
    select count(*) from public.match_event_registrations where match_event_id=e.id and lifecycle='accepted' and cancelled_at is null) then
    raise exception 'MATCH_MANAGEMENT_CAPACITY_BELOW_ACCEPTED' using errcode='P0001'; end if;
  -- Merged schedule + competition validated together; any failure rejects the whole edit.
  perform public.assert_match_league_edit_locked(e.id,e.community_id,e.published_at,e.league_id,merged.league_id,merged.starts_at,merged.event_type);
  if e.saved_venue_id is not null and (merged.venue_name is distinct from e.venue_name or merged.maps_url is distinct from e.maps_url)
    and not exists(select 1 from public.community_venues where id=e.saved_venue_id and name=merged.venue_name and maps_url=merged.maps_url) then
    merged.saved_venue_id:=null;
  end if;
  select coalesce(array_agg(key order by key collate "C"),'{}'::text[]),
    coalesce(jsonb_object_agg(key,to_jsonb(e)->key),'{}'),coalesce(jsonb_object_agg(key,to_jsonb(merged)->key),'{}')
    into fields,before_data,after_data from unnest(allowed||array['saved_venue_id']) key
    where to_jsonb(e)->key is distinct from to_jsonb(merged)->key;
  select transition_revision into rev from public.match_event_registration_state where match_event_id=e.id;
  if fields && array['event_type','starts_at','league_id'] then
    before_data:=before_data||jsonb_build_object('competition',public.match_competition_impact(e.league_id,e.event_type));
    after_data:=after_data||jsonb_build_object('competition',public.match_competition_impact(merged.league_id,merged.event_type));
  end if;
  major:=(fields && array['event_type','starts_at','league_id']) and exists(select 1 from public.match_event_registrations where match_event_id=e.id and lifecycle='accepted' and cancelled_at is null);
  generation:=e.reconfirmation_generation+case when major then 1 else 0 end;
  if major then before_roster:=public.snapshot_match_registration_roster_locked(e.id); end if;
  if cardinality(fields)>0 then
    -- Existing row CHECKs validate all merged text/maps/price/timestamp limits atomically.
    perform pg_catalog.set_config('app.edit_match_league_id',e.id::text,true);
    update public.match_events set event_type=merged.event_type,starts_at=merged.starts_at,league_id=merged.league_id,
      reconfirmation_generation=generation,venue_name=merged.venue_name,maps_url=merged.maps_url,court_notes=merged.court_notes,
      price_minor=merged.price_minor,currency=merged.currency,payment_note=merged.payment_note,notes=merged.notes,
      maximum_registrations=merged.maximum_registrations,registration_cutoff_at=merged.registration_cutoff_at,
      saved_venue_id=merged.saved_venue_id,version=version+1,updated_at=t where id=e.id;
    perform pg_catalog.set_config('app.edit_match_league_id','',true);
    if major then
      update public.match_event_registrations set required_generation=generation where match_event_id=e.id and lifecycle='accepted' and cancelled_at is null;
      update public.match_event_registration_attempts a set required_generation=generation
        from public.match_event_registrations r where r.match_event_id=e.id and r.lifecycle='accepted' and r.cancelled_at is null and a.id=r.current_attempt_id;
      -- AC13 (documented decision): provisional players cannot reconfirm, so they carry over. Both
      -- generations advance together on the registration and the attempt; reconfirmed_at stays null
      -- (no counterfeit user consent); accepted_order/attempt/accepted_at are untouched.
      select coalesce(array_agg(r.user_id order by r.accepted_order),'{}'::uuid[]) into carried
        from public.match_event_registrations r join public.player_profiles p on p.user_id=r.user_id
        where r.match_event_id=e.id and r.lifecycle='accepted' and r.cancelled_at is null and p.is_provisional;
      update public.match_event_registrations set confirmed_generation=generation
        where match_event_id=e.id and lifecycle='accepted' and cancelled_at is null and user_id=any(carried);
      update public.match_event_registration_attempts a set confirmed_generation=generation
        from public.match_event_registrations r where r.match_event_id=e.id and r.lifecycle='accepted' and r.cancelled_at is null
          and r.user_id=any(carried) and a.id=r.current_attempt_id;
      result:=public.reconcile_match_registration_participation(e.id,null,before_roster);
      rev:=(result->>'transition_revision')::bigint;
      for recipient in select user_id from public.match_event_registrations where match_event_id=e.id and lifecycle='accepted' and cancelled_at is null and not user_id=any(carried) loop
        perform public.persist_notification(recipient,'match.reconfirmation_required:'||e.id||':'||generation,
          'match_reconfirmation_required','matches','match_event',e.id,e.community_id);
      end loop;
    else rev:=public.advance_match_registration_revision_locked(e.id); end if;
    insert into public.match_event_audit_log(match_event_id,community_id,actor_id,action,request_id,
      occurred_at,event_version,transition_revision,before_data,after_data,changed_fields)
    values(e.id,e.community_id,a,case when major then 'major_edit' else 'minor_edit' end,p_request_id,t,e.version+1,rev,before_data,after_data||jsonb_build_object('reconfirmation_generation',generation),fields);
    insert into public.match_event_audit_log(match_event_id,community_id,actor_id,target_user_id,action,reason,request_id,
      occurred_at,event_version,transition_revision,before_data,after_data,changed_fields)
    select e.id,e.community_id,a,r.user_id,'reconfirmation_carried','provisional_system_carry',p_request_id,t,e.version+1,rev,
      jsonb_build_object('attempt_id',r.current_attempt_id,'required_generation',generation-1,'confirmed_generation',generation-1),
      jsonb_build_object('attempt_id',r.current_attempt_id,'required_generation',generation,'confirmed_generation',generation,'accepted_order',r.accepted_order),
      array['confirmed_generation','required_generation']
      from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=any(carried) order by r.accepted_order;
    for recipient in select user_id from public.match_event_registrations
      where match_event_id=e.id and lifecycle in ('accepted','pending') and cancelled_at is null and (not major or lifecycle='pending')
      union select invitee_user_id from public.match_event_invites where match_event_id=e.id and status='pending' and (not major or not exists(select 1 from public.match_event_registrations ar where ar.match_event_id=e.id and ar.user_id=invitee_user_id and ar.lifecycle='accepted' and ar.cancelled_at is null)) loop
      perform public.persist_notification(recipient,'match.updated:'||e.id||':'||(e.version+1),
        'match_event_updated','matches','match_event',e.id,e.community_id);
    end loop;
  end if;
  result:=jsonb_build_object('event_id',e.id,'version',e.version+case when cardinality(fields)>0 then 1 else 0 end,
    'transition_revision',rev,'request_id',p_request_id,'replayed',false,'changed',cardinality(fields)>0,
    'change_kind',case when cardinality(fields)>0 then case when major then 'major' else 'minor' end else 'none' end,'changed_fields',fields,
    'reconfirmation_generation',generation,'carried_count',cardinality(carried));
  insert into public.match_event_management_commands values(e.id,a,p_request_id,'edit',payload,result,t);
  return result;
end $$;

-- 6. Consent summary readable by the people it concerns: the audited before/after competition
-- impact of the edit that produced `p_generation`. League identity is hidden from nonmembers.
create function public.match_consent_change(p_event_id uuid, p_generation bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'generation', p_generation,
    'changed_fields', a.changed_fields,
    'from', case when public.is_community_member(a.community_id) then a.before_data->'competition'
      else (a.before_data->'competition') - array['league_id','league_name','league_start_at','league_end_at','league_timezone'] end,
    'to', case when public.is_community_member(a.community_id) then a.after_data->'competition'
      else (a.after_data->'competition') - array['league_id','league_name','league_start_at','league_end_at','league_timezone'] end)
  from public.match_event_audit_log a
  where a.match_event_id = p_event_id and a.action = 'major_edit'
    and (a.after_data->>'reconfirmation_generation')::bigint = p_generation
  order by a.occurred_at desc, a.id desc limit 1;
$$;

do $$
declare d text;
begin
  d:=pg_get_functiondef('public.get_my_match_registration(uuid)'::regprocedure);
  d:=replace(d,'''registration_cutoff_at'',e.registration_cutoff_at,',
    '''registration_cutoff_at'',e.registration_cutoff_at,''consent_change'',case when r.lifecycle=''accepted'' and r.confirmed_generation<r.required_generation then public.match_consent_change(e.id,r.required_generation) end,');
  if position('match_consent_change' in d)=0 then raise exception 'registration consent extension failed'; end if;
  execute d;
  d:=pg_get_functiondef('public.get_match_event_management(uuid)'::regprocedure);
  d:=replace(d,'''required_count'',(select reconfirmation_required_count from public.match_registration_counts(e.id,t)),',
    '''required_count'',(select reconfirmation_required_count from public.match_registration_counts(e.id,t)),''consent_change'',case when e.created_by=auth.uid() and e.reconfirmation_generation>0 then public.match_consent_change(e.id,e.reconfirmation_generation) end,');
  if position('match_consent_change' in d)=0 then raise exception 'management consent extension failed'; end if;
  execute d;
  -- League window next to the League identity (members only, like the identity itself).
  d:=pg_get_functiondef('public.match_event_competition(uuid)'::regprocedure);
  d:=replace(d,'''league_name'', case when public.is_community_member(e.community_id)
      then (select l.name from public.leagues l where l.id = e.league_id) end)',
    '''league_name'', case when public.is_community_member(e.community_id)
      then (select l.name from public.leagues l where l.id = e.league_id) end,
    ''league_start_date'', case when public.is_community_member(e.community_id)
      then (select ((l.start_at at time zone l.timezone)::date)::text from public.leagues l where l.id = e.league_id) end,
    ''league_end_date'', case when public.is_community_member(e.community_id)
      then (select ((public.match_league_effective_end(l.end_at, l.closed_at) at time zone l.timezone)::date)::text from public.leagues l where l.id = e.league_id) end)');
  if position('league_start_date' in d)=0 then raise exception 'competition window extension failed'; end if;
  execute d;
end $$;

revoke all on function public.match_league_effective_end(timestamptz, timestamptz),
  public.match_competition_impact(uuid, public.match_event_type),
  public.assert_match_league_edit_locked(uuid, uuid, timestamptz, uuid, uuid, timestamptz, public.match_event_type),
  public.match_consent_change(uuid, bigint) from public, anon, authenticated, service_role;
revoke all on function public.edit_match_event(uuid,bigint,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.edit_match_event(uuid,bigint,jsonb,uuid) to authenticated;

commit;
