begin;

alter table public.match_event_registrations
  add column current_attempt_id uuid references public.match_event_registration_attempts(id) on delete restrict,
  add column left_at timestamptz,
  add column removed_by uuid references auth.users(id) on delete restrict,
  add column removal_reason text check (removal_reason = btrim(removal_reason)
    and length(removal_reason) between 1 and 500 and removal_reason !~ '[[:cntrl:]]'),
  drop constraint match_registration_lifecycle_anchors,
  add constraint match_registration_lifecycle_anchors check (
    (lifecycle in ('accepted','withdrawn','removed_by_creator') and accepted_at is not null
      and accepted_order is not null and (approved_at is null or approved_at = accepted_at))
    or (lifecycle in ('pending','rejected','expired') and accepted_at is null
      and accepted_order is null and approved_at is null)),
  add constraint match_registration_departure_metadata check (
    (lifecycle <> 'withdrawn' or left_at is not null)
    and (lifecycle <> 'removed_by_creator' or (removed_by is not null
      and removal_reason is not null and resolved_at is not null)));

alter table public.match_event_registration_attempts
  add column registration_id uuid references public.match_event_registrations(id) on delete restrict,
  add column accepted_at timestamptz,
  add column approved_at timestamptz,
  add column accepted_order bigint,
  add column registration_source public.match_registration_source,
  add column ended_at timestamptz,
  add column ended_by uuid references auth.users(id) on delete restrict,
  add column end_reason text check (end_reason = btrim(end_reason)
    and length(end_reason) between 1 and 500 and end_reason !~ '[[:cntrl:]]'),
   add column end_kind text check (end_kind in ('withdrawn','removed_by_creator','reconfirmation_expired','cancelled','superseded'));

-- Fail closed: no historical queue position can be invented or assigned to an
-- arbitrary accepted attempt. This check runs before changing any ledger data.
do $$ begin
  if exists (select 1 from public.match_event_registration_attempts a
    where a.outcome = 'accepted' group by a.match_event_id,a.user_id having count(*) > 1)
    or exists (select 1 from public.match_event_registration_attempts a
      join public.match_event_registrations r using(match_event_id,user_id)
      where a.outcome = 'accepted' and r.lifecycle <> 'accepted') then
    raise exception 'Ambiguous historical accepted registration attempts' using errcode = '23514';
  end if;
end $$;
update public.match_event_registration_attempts a set registration_id = r.id,
  registration_source = r.registration_source,
  accepted_at = case when a.outcome = 'accepted' then r.accepted_at end,
  approved_at = case when a.outcome = 'accepted' then r.approved_at end,
  accepted_order = case when a.outcome = 'accepted' then r.accepted_order end
from public.match_event_registrations r where r.match_event_id = a.match_event_id and r.user_id = a.user_id;
insert into public.match_event_registration_attempts(match_event_id,user_id,registration_id,
  requested_at,decided_at,outcome,actor_id,accepted_at,approved_at,accepted_order,registration_source)
select r.match_event_id,r.user_id,r.id,
  case when r.lifecycle='accepted' then r.accepted_at
    when r.lifecycle='pending' then coalesce(r.requested_at,clock_timestamp())
    else coalesce(r.requested_at,r.resolved_at,clock_timestamp()) end,
  case when r.lifecycle='accepted' then r.accepted_at
    when r.lifecycle='pending' then null
    else coalesce(r.resolved_at,r.requested_at,clock_timestamp()) end,
  r.lifecycle,case when r.lifecycle='accepted' then r.user_id
    when r.lifecycle='pending' then null else r.resolved_by end,
  r.accepted_at,r.approved_at,r.accepted_order,r.registration_source
from public.match_event_registrations r where not exists (
  select 1 from public.match_event_registration_attempts a where a.registration_id = r.id and a.outcome = r.lifecycle);
-- Decision time is not acceptance time. Preserve it; canonical anchors above
-- come exclusively from the registration. Latest request/id is deterministic.
update public.match_event_registrations r set current_attempt_id = (
  select a.id from public.match_event_registration_attempts a
  where a.registration_id=r.id and a.outcome=r.lifecycle
  order by a.requested_at desc,a.id desc limit 1);
-- Authorized projection reconstruction: superseded requests lose open identity,
-- but retain their decision evidence unless they were still pending.
with ordered as (
  select a.id,lead(a.requested_at) over (
    partition by a.match_event_id,a.user_id order by a.requested_at,a.id) as next_requested_at
  from public.match_event_registration_attempts a
), endings as (
  select a.id,coalesce(r.resolved_at,o.next_requested_at,a.requested_at) as ended_at
  from public.match_event_registration_attempts a
  join public.match_event_registrations r on r.id=a.registration_id
  join ordered o on o.id=a.id
  where a.id<>r.current_attempt_id and a.ended_at is null
)
update public.match_event_registration_attempts a
set ended_at=e.ended_at,end_kind='superseded',
  end_reason='superseded by later registration attempt',
  outcome=case when a.outcome='pending' then 'expired'::public.match_registration_lifecycle else a.outcome end,
  decided_at=case when a.outcome='pending' then e.ended_at else a.decided_at end,
  actor_id=case when a.outcome='pending' then null else a.actor_id end
from endings e where e.id=a.id;
alter table public.match_event_registration_attempts
  alter column registration_id set not null,
  alter column registration_source set not null,
  add constraint match_attempt_accepted_anchors check (
    (accepted_at is null) = (accepted_order is null)
    and ((outcome = 'accepted') = (accepted_at is not null))
    and (approved_at is null or approved_at = accepted_at)),
  add constraint match_attempt_ending check (((end_kind is null) = (ended_at is null))
    and (outcome <> 'accepted' or ended_at is null or end_kind is not null)
    and (end_kind <> 'removed_by_creator' or (ended_by is not null and end_reason is not null)));
create unique index match_attempt_accepted_order on public.match_event_registration_attempts(match_event_id,accepted_order)
  where accepted_order is not null;
create unique index match_attempt_open_identity on public.match_event_registration_attempts(match_event_id,user_id)
  where ended_at is null and outcome in ('pending','accepted');

create function public.guard_match_registration_attempt() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Attempt history is immutable' using errcode='23514'; end if;
  if old.ended_at is not null or old.outcome in ('rejected','expired')
    or (new.id,new.registration_id,new.match_event_id,new.user_id,new.requested_at,new.registration_source)
      is distinct from (old.id,old.registration_id,old.match_event_id,old.user_id,old.requested_at,old.registration_source)
    or (old.outcome='accepted' and (new.outcome,new.decided_at,new.actor_id,new.accepted_at,new.approved_at,new.accepted_order)
      is distinct from (old.outcome,old.decided_at,old.actor_id,old.accepted_at,old.approved_at,old.accepted_order)) then
    raise exception 'Attempt history is immutable' using errcode='23514';
  end if;
  return new;
end $$;
create trigger match_attempt_history_guard before update or delete on public.match_event_registration_attempts
  for each row execute function public.guard_match_registration_attempt();

-- Read final state, not the queued NEW tuple: one command may stage lifecycle
-- before reconcile clears participation. The constraint must check commit state.
create function public.check_match_registration_final_state() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.match_event_registrations%rowtype; a public.match_event_registration_attempts%rowtype;
begin
  select * into r from public.match_event_registrations
    where id=case when tg_table_name='match_event_registration_attempts'
      then (to_jsonb(new)->>'registration_id')::uuid else new.id end;
  if not found then return null; end if;
  select * into a from public.match_event_registration_attempts where id=r.current_attempt_id;
  if a.id is null or a.registration_id <> r.id or a.match_event_id <> r.match_event_id or a.user_id <> r.user_id
    or a.registration_source is distinct from r.registration_source
    or (r.lifecycle='accepted' and (r.participation_status is null or a.outcome <> 'accepted' or a.ended_at is not null))
    or (r.lifecycle <> 'accepted' and r.participation_status is not null)
    or (r.lifecycle in ('pending','rejected','expired') and a.outcome is distinct from r.lifecycle)
    or (r.lifecycle='pending' and a.ended_at is not null)
    or (r.lifecycle in ('accepted','withdrawn','removed_by_creator') and
      (r.accepted_at,r.approved_at,r.accepted_order) is distinct from (a.accepted_at,a.approved_at,a.accepted_order))
    or (r.lifecycle in ('withdrawn','removed_by_creator') and (a.end_kind is distinct from r.lifecycle::text or a.ended_at is null)) then
    raise exception 'Invalid final registration state' using errcode='23514';
  end if;
  if (r.lifecycle='withdrawn' and r.left_at is distinct from a.ended_at)
    or (r.lifecycle='removed_by_creator' and (r.removed_by,r.removal_reason,r.resolved_at)
      is distinct from (a.ended_by,a.end_reason,a.ended_at)) then
    raise exception 'Departure evidence disagrees with current attempt' using errcode='23514';
  end if;
  -- Due/unprocessed rows intentionally retain the last persisted status during
  -- cron downtime; pure reads derive the deadline projection without writes.
  if r.lifecycle='accepted' and exists(
    select 1 from public.match_events e join public.match_event_registration_state s on s.match_event_id=e.id
      where e.id=r.match_event_id and (e.registration_cutoff_at>clock_timestamp() or s.cutoff_processed_at is not null))
    and r.participation_status is distinct from (
      select q.participation_status from public.match_registration_roster(r.match_event_id) q where q.registration_id=r.id) then
    raise exception 'Invalid final participation state' using errcode='23514';
  end if;
  return null;
end $$;
create constraint trigger match_registration_final_state after insert or update on public.match_event_registrations
  deferrable initially deferred for each row execute function public.check_match_registration_final_state();
create constraint trigger match_attempt_final_state after insert or update on public.match_event_registration_attempts
  deferrable initially deferred for each row execute function public.check_match_registration_final_state();

create table public.match_event_audit_log (
  id uuid primary key default gen_random_uuid(),
  match_event_id uuid not null references public.match_events(id) on delete restrict,
  community_id uuid not null references public.communities(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete restrict,
  target_user_id uuid references auth.users(id) on delete restrict,
  action text not null check (action in ('withdraw','remove','transfer','cancel','minor_edit','major_edit','reconfirm','reconfirmation_excluded')),
  reason text check (reason=btrim(reason) and length(reason) between 1 and 500 and reason !~ '[[:cntrl:]]'),
  request_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  event_version bigint,
  transition_revision bigint not null,
  before_data jsonb not null default '{}' check (jsonb_typeof(before_data)='object'),
  after_data jsonb not null default '{}' check (jsonb_typeof(after_data)='object'),
  changed_fields text[] not null default '{}',
  check (action not in ('remove','cancel') or reason is not null),
  check (action <> 'remove' or target_user_id is not null),
  check (actor_id is not null or action='reconfirmation_excluded'),
  check (action <> 'transfer' or (before_data ? 'owner_id' and after_data ? 'owner_id'))
);
create index match_audit_event_cursor on public.match_event_audit_log(match_event_id,occurred_at desc,id desc);
create index match_audit_community_cursor on public.match_event_audit_log(community_id,occurred_at desc,id desc);
alter table public.match_event_audit_log enable row level security;
create policy match_audit_manager_read on public.match_event_audit_log for select to authenticated using (
  exists(select 1 from public.match_events e where e.id=match_event_id and
    (e.created_by=auth.uid() or public.is_community_admin(e.community_id))));
create function public.guard_match_event_audit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op <> 'INSERT' then raise exception 'Match audit is insert-only' using errcode='23514'; end if;
  if not exists(select 1 from public.match_events e where e.id=new.match_event_id and e.community_id=new.community_id) then
    raise exception 'Audit community does not match event' using errcode='23514';
  end if;
  return new;
end $$;
create trigger match_audit_immutable before insert or update or delete on public.match_event_audit_log
  for each row execute function public.guard_match_event_audit();
create table public.match_event_management_commands (
  match_event_id uuid not null references public.match_events(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  action text not null check (action in ('withdraw','remove','transfer','cancel','edit','reconfirm')),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  result jsonb not null check(jsonb_typeof(result)='object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key(match_event_id,actor_id,request_id)
);
alter table public.match_event_management_commands enable row level security;
revoke all on public.match_event_audit_log,public.match_event_management_commands from public,anon,authenticated;
grant select on public.match_event_audit_log to authenticated;

alter table public.match_event_registration_state add column results_protected_at timestamptz;
create function public.guard_match_results_protection() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.results_protected_at is not null and new.results_protected_at is distinct from old.results_protected_at then
    raise exception 'Result protection is monotonic' using errcode='23514';
  end if;
  return new;
end $$;
create trigger match_results_protection_guard before update on public.match_event_registration_state
  for each row execute function public.guard_match_results_protection();
create function public.protect_match_event_results(p_event_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform public.lock_match_event_registration(p_event_id);
  if not exists(select 1 from public.match_events e where e.id=p_event_id)
    or exists(select 1 from public.match_events e where e.id=p_event_id
      and (to_jsonb(e)->>'status'='cancelled' or to_jsonb(e)->>'cancelled_at' is not null)) then
    raise exception 'MATCH_MANAGEMENT_CANCELLED' using errcode='P0001';
  end if;
  update public.match_event_registration_state set results_protected_at=coalesce(results_protected_at,clock_timestamp())
    where match_event_id=p_event_id;
end $$;

create function public.advance_match_registration_revision_locked(p_event_id uuid) returns bigint
language sql security definer set search_path='' as $$
  update public.match_event_registration_state set transition_revision=transition_revision+1
    where match_event_id=p_event_id returning transition_revision;
$$;

-- Explicit member arrays preserve pre-staging group evidence even when an
-- accepted row becomes terminal before reconciliation.
create function public.snapshot_match_registration_roster_locked(p_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with ranked as (
    select r.id,r.user_id,r.participation_status,
      (row_number() over(order by r.accepted_order,r.id)-1)/4 as quartet
     from public.match_registration_roster(p_event_id) q
     join public.match_event_registrations r on r.id=q.registration_id
     where r.participation_status is not null
  ), members as (
    select quartet,jsonb_agg(user_id order by id) as users from ranked
    where participation_status='playing' group by quartet
  )
  select coalesce(jsonb_object_agg(r.id::text,jsonb_build_object('status',r.participation_status,
    'user_id',r.user_id,'members',case when r.participation_status='playing' then m.users else '[]'::jsonb end)), '{}')
  from ranked r left join members m using(quartet);
$$;

-- Keep old callers working through a thin forwarding overload; the new helper
-- remains the only participation updater.
create function public.reconcile_match_registration_participation(
  p_match_event_id uuid,p_accepted_registration_id uuid,p_before_roster jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_before jsonb; v_after jsonb; v_revision bigint; v_community uuid; v_counts record;
  v_row record; v_old text; v_kind text; v_key text; v_new jsonb; v_old_members jsonb;
  v_accepted public.match_event_registrations%rowtype;
begin
  v_before:=coalesce(p_before_roster,public.snapshot_match_registration_roster_locked(p_match_event_id));
   if jsonb_typeof(v_before)<>'object' then raise exception 'Invalid roster snapshot' using errcode='22023'; end if;
   if exists(select 1 from jsonb_each(v_before) b where
     b.key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or jsonb_typeof(b.value)<>'object'
     or coalesce(b.value->>'status','') not in ('playing','reserve','reserve_not_playing')
     or coalesce(b.value->>'user_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(jsonb_typeof(b.value->'members'),'null')<>'array') then
     raise exception 'Invalid roster snapshot' using errcode='22023';
   end if;
  select e.community_id into v_community from public.match_events e where e.id=p_match_event_id;
  if v_community is null then raise exception 'MATCH_REGISTRATION_EVENT_NOT_FOUND' using errcode='P0001'; end if;
  update public.match_event_registrations set participation_status=null
    where match_event_id=p_match_event_id and lifecycle<>'accepted' and participation_status is not null;
  update public.match_event_registrations r set participation_status=q.participation_status
    from public.match_registration_roster(p_match_event_id) q where r.id=q.registration_id
      and r.participation_status is distinct from q.participation_status;
  v_revision:=public.advance_match_registration_revision_locked(p_match_event_id);
  v_after:=public.snapshot_match_registration_roster_locked(p_match_event_id);
  for v_row in select * from public.match_registration_roster(p_match_event_id) order by roster_position loop
    v_new:=v_after->v_row.registration_id::text;
    v_old:=case when v_row.registration_id=p_accepted_registration_id then null
      else v_before->v_row.registration_id::text->>'status' end;
    v_kind:=null; v_key:=null;
    if v_old is distinct from v_row.participation_status::text then
      if v_row.participation_status='playing' then
        if v_old='reserve' then v_kind:='match_registration_promoted'; v_key:='fifo_promoted';
        else v_kind:='match_registration_playing'; v_key:='fifo_playing'; end if;
      elsif v_row.participation_status='reserve' then v_kind:='match_registration_reserve'; v_key:='fifo_reserve';
      else v_kind:='match_registration_not_playing'; v_key:='cutoff_not_playing'; end if;
      perform public.persist_notification(v_row.user_id,'match.'||v_key||':'||p_match_event_id||':'||v_revision||':'||v_row.user_id,
        v_kind,'matches','match_event',p_match_event_id,v_community);
    end if;
    v_old_members:=v_before->v_row.registration_id::text->'members';
    if v_old='playing' and v_old_members is distinct from v_new->'members' then
      perform public.persist_notification(v_row.user_id,'match.group_changed:'||p_match_event_id||':'||v_revision||':'||v_row.user_id,
        'match_registration_group_changed','matches','match_event',p_match_event_id,v_community);
    end if;
    -- Only newly completed groups, never a changed but already complete group.
    if v_row.participation_status='playing' and not exists (
      select 1 from jsonb_each(v_before) b where b.value->>'status'='playing'
        and b.value->'members'=v_new->'members')
      and not exists (
        select 1 from jsonb_each(v_before) b where b.value->>'status'='playing'
          and (v_new->'members') ? (b.value->>'user_id')) then
      perform public.persist_notification(v_row.user_id,'match.fifo_quartet_complete:'||p_match_event_id||':'||v_revision||':'||v_row.user_id,
        'match_registration_quartet_complete','matches','match_event',p_match_event_id,v_community);
    end if;
  end loop;
  select * into v_counts from public.match_registration_counts(p_match_event_id);
  select * into v_accepted from public.match_event_registrations where id=p_accepted_registration_id;
  return jsonb_build_object('event_id',p_match_event_id,'transition_revision',v_revision,
    'accepted_count',v_counts.accepted_count,'playing_count',v_counts.playing_count,
    'reserve_count',v_counts.reserve_count,'reserve_not_playing_count',v_counts.reserve_not_playing_count,
    'accepted_participation',v_accepted.participation_status,'accepted_order',v_accepted.accepted_order);
end $$;
create or replace function public.reconcile_match_registration_participation(
  p_match_event_id uuid,p_accepted_registration_id uuid default null)
returns jsonb language sql security definer set search_path='' as $$
  select public.reconcile_match_registration_participation(p_match_event_id,p_accepted_registration_id,null);
$$;

create function public.depart_match_registration_locked(p_match_event_id uuid,p_target_user_id uuid,
  p_attempt_id uuid,p_reason text,p_request_id uuid,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_event public.match_events%rowtype; v_row public.match_event_registrations%rowtype;
  v_command public.match_event_management_commands%rowtype; v_now timestamptz; v_payload jsonb; v_before jsonb;
  v_result jsonb; v_revision bigint; v_user uuid; v_kind text; v_lifecycle public.match_registration_lifecycle;
begin
  if v_actor is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then
    raise exception 'Authentication required' using errcode='28000'; end if;
  if p_attempt_id is null or p_request_id is null or p_target_user_id is null or p_action is null or p_action not in ('withdraw','remove') then
    raise exception 'Invalid departure command' using errcode='22023'; end if;
  if p_action='remove' and (p_reason is null or length(btrim(p_reason)) not between 1 and 500 or p_reason ~ '[[:cntrl:]]') then
    raise exception 'Removal reason required' using errcode='22023'; end if;
  begin
    v_event:=public.lock_match_event_registration(p_match_event_id);
  exception when raise_exception then
    if sqlerrm='MATCH_REGISTRATION_EVENT_NOT_FOUND' then
      raise exception 'MATCH_MANAGEMENT_NOT_FOUND' using errcode='P0001';
    end if;
    raise;
  end;
  perform 1 from public.match_event_registrations where match_event_id=p_match_event_id order by id for update;
  perform 1 from public.match_event_registration_attempts where match_event_id=p_match_event_id order by id for update;
  v_now:=clock_timestamp();
  if p_action='remove' and (v_event.created_by<>v_actor or p_target_user_id=v_actor)
    or p_action='withdraw' and p_target_user_id<>v_actor then
    raise exception 'Departure forbidden' using errcode='42501'; end if;
  if to_jsonb(v_event)->>'status'='cancelled' then raise exception 'MATCH_MANAGEMENT_CANCELLED' using errcode='P0001'; end if;
  if v_now >= v_event.starts_at then raise exception 'MATCH_MANAGEMENT_STARTED' using errcode='P0001'; end if;
  if exists(select 1 from public.match_event_registration_state where match_event_id=p_match_event_id and results_protected_at is not null) then
    raise exception 'MATCH_MANAGEMENT_RESULT_PROTECTED' using errcode='P0001'; end if;
  if v_now >= v_event.registration_cutoff_at then raise exception 'MATCH_MANAGEMENT_CLOSED' using errcode='P0001'; end if;
  v_payload:=jsonb_build_object('attempt_id',p_attempt_id,'target_user_id',p_target_user_id,'reason',case when p_action='remove' then btrim(p_reason) end);
  select * into v_command from public.match_event_management_commands where match_event_id=p_match_event_id
    and actor_id=v_actor and request_id=p_request_id;
  if found then
    if v_command.action<>p_action or v_command.payload<>v_payload then
      raise exception 'MATCH_MANAGEMENT_IDEMPOTENCY_CONFLICT' using errcode='P0001'; end if;
    return v_command.result || jsonb_build_object('replayed',true);
  end if;
  select * into v_row from public.match_event_registrations where match_event_id=p_match_event_id and user_id=p_target_user_id;
  if v_row.current_attempt_id is distinct from p_attempt_id then raise exception 'MATCH_MANAGEMENT_STALE_ATTEMPT' using errcode='P0001'; end if;
   if v_row.id is null or v_row.lifecycle<>'accepted' then raise exception 'MATCH_MANAGEMENT_TARGET_NOT_ACCEPTED' using errcode='P0001'; end if;
  v_before:=public.snapshot_match_registration_roster_locked(p_match_event_id);
  v_lifecycle:=case when p_action='remove' then 'removed_by_creator' else 'withdrawn' end;
  update public.match_event_registration_attempts set ended_at=v_now,ended_by=v_actor,
    end_kind=v_lifecycle::text,end_reason=case when p_action='remove' then btrim(p_reason) end
    where id=p_attempt_id and ended_at is null and outcome='accepted';
  if not found then raise exception 'MATCH_MANAGEMENT_STALE_ATTEMPT' using errcode='P0001'; end if;
  update public.match_event_registrations set lifecycle=v_lifecycle,
    left_at=case when p_action='withdraw' then v_now end,
    removed_by=case when p_action='remove' then v_actor end,
    removal_reason=case when p_action='remove' then btrim(p_reason) end,
    resolved_at=v_now,resolved_by=v_actor where id=v_row.id;
  v_result:=public.reconcile_match_registration_participation(p_match_event_id,null,v_before);
  v_revision:=(v_result->>'transition_revision')::bigint;
  insert into public.match_event_audit_log(match_event_id,community_id,actor_id,target_user_id,action,reason,
    request_id,occurred_at,transition_revision,before_data,after_data,changed_fields)
  values(p_match_event_id,v_event.community_id,v_actor,p_target_user_id,p_action,
    case when p_action='remove' then btrim(p_reason) end,p_request_id,v_now,v_revision,
    jsonb_build_object('attempt_id',p_attempt_id,'accepted_order',v_row.accepted_order,'lifecycle','accepted'),
    jsonb_build_object('attempt_id',p_attempt_id,'accepted_order',v_row.accepted_order,'lifecycle',v_lifecycle),array['lifecycle']);
  v_kind:=case when p_action='remove' then 'match_registration_removed' else 'match_registration_withdrawn' end;
  for v_user in select distinct x from unnest(array[v_event.created_by,p_target_user_id]) x loop
    perform public.persist_notification(v_user,'match.'||case when p_action='remove' then 'removed' else 'withdrawn' end||':'||p_match_event_id||':'||p_attempt_id,
      v_kind,'matches','match_event',p_match_event_id,v_event.community_id);
  end loop;
  v_result:=jsonb_build_object('event_id',p_match_event_id,'version',1,'transition_revision',v_revision,
    'request_id',p_request_id,'replayed',false,'changed',true);
  insert into public.match_event_management_commands(match_event_id,actor_id,request_id,action,payload,result)
    values(p_match_event_id,v_actor,p_request_id,p_action,v_payload,v_result);
  return v_result;
end $$;
create function public.withdraw_match_registration(p_match_event_id uuid,p_attempt_id uuid,p_request_id uuid) returns jsonb
language sql security definer set search_path='' as $$
  select public.depart_match_registration_locked(p_match_event_id,auth.uid(),p_attempt_id,null,p_request_id,'withdraw');
$$;
create function public.remove_match_registration(p_match_event_id uuid,p_target_user_id uuid,p_attempt_id uuid,p_reason text,p_request_id uuid) returns jsonb
language sql security definer set search_path='' as $$
  select public.depart_match_registration_locked(p_match_event_id,p_target_user_id,p_attempt_id,p_reason,p_request_id,'remove');
$$;
create function public.list_match_event_management_participants(p_match_event_id uuid) returns setof jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'Authentication required' using errcode='28000'; end if;
  return query select jsonb_build_object('user_id',r.user_id,'registration_id',r.id,'attempt_id',r.current_attempt_id,
    'display_name',p.display_name,'display_level',g.display_level,'lifecycle',r.lifecycle,
    'participation',r.participation_status,'accepted_order',r.accepted_order)
  from public.match_event_registrations r join public.match_events e on e.id=r.match_event_id
    left join public.player_profiles p on p.user_id=r.user_id left join public.global_player_ratings g on g.user_id=r.user_id
  where e.id=p_match_event_id and e.created_by=auth.uid() and r.lifecycle='accepted' order by r.accepted_order,r.id;
end $$;
create function public.list_match_event_audit(p_match_event_id uuid,p_before_at timestamptz default null,
  p_before_id uuid default null,p_limit integer default 20) returns setof jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'Authentication required' using errcode='28000'; end if;
  if (p_before_at is null) <> (p_before_id is null) or p_limit is null or p_limit<1 then raise exception 'Invalid audit cursor' using errcode='22023'; end if;
  if not exists(select 1 from public.match_events e where e.id=p_match_event_id and
    (e.created_by=auth.uid() or public.is_community_admin(e.community_id))) then raise exception 'Audit forbidden' using errcode='42501'; end if;
  return query select to_jsonb(a) from public.match_event_audit_log a where a.match_event_id=p_match_event_id
    and (p_before_at is null or (a.occurred_at,a.id)<(p_before_at,p_before_id))
    order by a.occurred_at desc,a.id desc limit least(p_limit,50);
end $$;

revoke all on function public.guard_match_registration_attempt(),public.check_match_registration_final_state(),
  public.guard_match_results_protection(),
  public.guard_match_event_audit(),public.protect_match_event_results(uuid),public.advance_match_registration_revision_locked(uuid),
  public.snapshot_match_registration_roster_locked(uuid),public.reconcile_match_registration_participation(uuid,uuid,jsonb),
  public.depart_match_registration_locked(uuid,uuid,uuid,text,uuid,text),public.withdraw_match_registration(uuid,uuid,uuid),
  public.remove_match_registration(uuid,uuid,uuid,text,uuid),public.list_match_event_management_participants(uuid),
  public.list_match_event_audit(uuid,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function public.withdraw_match_registration(uuid,uuid,uuid),public.remove_match_registration(uuid,uuid,uuid,text,uuid),
  public.list_match_event_management_participants(uuid),public.list_match_event_audit(uuid,timestamptz,uuid,integer) to authenticated;

-- Ordinary entry still owns eligibility and FIFO allocation. A re-entry replaces
-- only the current projection; the closed attempt remains immutable.
create or replace function public.submit_match_registration_locked(p_match_event_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_event public.match_events%rowtype; v_row public.match_event_registrations%rowtype;
  v_invite public.match_event_invites%rowtype; v_now timestamptz:=clock_timestamp();
  v_member boolean; v_public boolean; v_rating numeric; v_accepted boolean; v_source public.match_registration_source;
  v_lifecycle public.match_registration_lifecycle; v_participation public.match_registration_participation;
  v_order bigint; v_count integer; v_id uuid; v_attempt uuid:=gen_random_uuid(); v_result jsonb;
begin
  select * into v_event from public.match_events where id=p_match_event_id;
  if v_now>=v_event.registration_cutoff_at then raise exception 'MATCH_REGISTRATION_CLOSED' using errcode='P0001'; end if;
  select * into v_invite from public.match_event_invites where match_event_id=p_match_event_id and invitee_user_id=p_actor_id;
  if v_event.visibility<>'community_open' and (v_invite.id is null or v_invite.status not in ('pending','accepted')) then
    raise exception 'MATCH_REGISTRATION_INVITE_ONLY' using errcode='P0001'; end if;
  v_member:=public.match_registration_is_member(v_event.community_id,p_actor_id);
  select display_level into v_rating from public.global_player_ratings where user_id=p_actor_id;
  select visibility='public' into v_public from public.communities where id=v_event.community_id;
  if v_member then v_accepted:=not v_event.restriction_enabled or (v_rating is not null and v_rating between v_event.min_level and v_event.max_level); v_source:='member';
  elsif v_public then v_accepted:=false; v_source:='guest';
  else raise exception 'MATCH_REGISTRATION_DENIED' using errcode='P0001'; end if;
  select * into v_row from public.match_event_registrations where match_event_id=p_match_event_id and user_id=p_actor_id;
  if v_row.lifecycle='accepted' then raise exception 'MATCH_REGISTRATION_DUPLICATE' using errcode='P0001'; end if;
  if v_row.lifecycle='pending' then raise exception 'MATCH_REGISTRATION_PENDING_DUPLICATE' using errcode='P0001'; end if;
  if v_accepted then
    select count(*) into v_count from public.match_event_registrations where match_event_id=p_match_event_id and lifecycle='accepted';
    if v_event.maximum_registrations is not null and v_count>=v_event.maximum_registrations then raise exception 'MATCH_REGISTRATION_FULL' using errcode='P0001'; end if;
    update public.match_event_registration_state set next_accepted_ordinal=next_accepted_ordinal+1
      where match_event_id=p_match_event_id returning next_accepted_ordinal-1 into v_order;
    v_lifecycle:='accepted'; v_participation:='reserve';
  else v_lifecycle:='pending'; end if;
  if v_row.id is not null then
    update public.match_event_registrations set lifecycle=v_lifecycle,accepted_at=case when v_accepted then v_now end,
      approved_at=null,accepted_order=v_order,registration_source=v_source,requested_at=v_now,
      resolved_at=null,resolved_by=null,left_at=null,removed_by=null,removal_reason=null
      where id=v_row.id returning id into v_id;
  else
    insert into public.match_event_registrations(match_event_id,user_id,lifecycle,accepted_at,accepted_order,participation_status,registration_source,requested_at)
      values(p_match_event_id,p_actor_id,v_lifecycle,case when v_accepted then v_now end,v_order,v_participation,v_source,v_now) returning id into v_id;
  end if;
  insert into public.match_event_registration_attempts(id,registration_id,match_event_id,user_id,requested_at,decided_at,outcome,actor_id,
    accepted_at,accepted_order,registration_source)
    values(v_attempt,v_id,p_match_event_id,p_actor_id,v_now,case when v_accepted then v_now end,v_lifecycle,
      case when v_accepted then p_actor_id end,case when v_accepted then v_now end,v_order,v_source);
  update public.match_event_registrations set current_attempt_id=v_attempt where id=v_id;
  if v_accepted then
    v_result:=public.reconcile_match_registration_participation(p_match_event_id,v_id);
    v_participation:=(v_result->>'accepted_participation')::public.match_registration_participation;
  else
    perform public.persist_notification(v_event.created_by,'match.registration_requested:'||v_id||':'||v_attempt,
      'match_registration_requested','matches','match_event',p_match_event_id,v_event.community_id);
  end if;
  v_result:=jsonb_build_object('event_id',p_match_event_id,'user_id',p_actor_id,'lifecycle',v_lifecycle,
    'participation',v_participation,'accepted_order',v_order,'registration_source',v_source,'requested_at',v_now,
    'approved_at',null,'accepted_at',case when v_accepted then v_now end,'already_registered',false);
  if v_invite.status='pending' then
    update public.match_event_invites set status='accepted',responded_at=v_now,responded_by=p_actor_id,submission_result=v_result where id=v_invite.id;
    perform public.persist_notification(v_event.created_by,'match.invitation_accepted:'||v_invite.id,
      'match_invitation_accepted','matches','match_event',p_match_event_id,v_event.community_id);
  end if;
  return v_result;
end $$;

create or replace function public.register_match_event_creator() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_attempt uuid;
begin
  if new.starts_at<=clock_timestamp() then raise exception 'Match must start in the future' using errcode='23514'; end if;
  insert into public.match_event_registration_state(match_event_id,next_accepted_ordinal) values(new.id,2);
  insert into public.match_event_registrations(match_event_id,user_id,accepted_at,accepted_order,participation_status,registration_source)
    values(new.id,new.created_by,new.published_at,1,'reserve','creator') returning id into v_id;
  insert into public.match_event_registration_attempts(registration_id,match_event_id,user_id,requested_at,decided_at,outcome,actor_id,
    accepted_at,accepted_order,registration_source) values(v_id,new.id,new.created_by,new.published_at,new.published_at,'accepted',new.created_by,new.published_at,1,'creator') returning id into v_attempt;
  update public.match_event_registrations set current_attempt_id=v_attempt where id=v_id;
  return new;
end $$;

create or replace function public.decide_match_registration(p_match_event_id uuid,p_attempt_id uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_event public.match_events%rowtype; v_row public.match_event_registrations%rowtype;
  v_attempt public.match_event_registration_attempts%rowtype; v_now timestamptz; v_order bigint; v_count integer;
  v_public boolean; v_result jsonb; v_status public.match_registration_participation;
begin
  if v_actor is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'Authentication required' using errcode='28000'; end if;
   if p_attempt_id is null then raise exception 'Match registration attempt required' using errcode='22023'; end if;
   if p_decision is null or p_decision not in ('approve','reject') then raise exception 'Invalid registration decision' using errcode='22023'; end if;
  v_event:=public.lock_match_event_registration(p_match_event_id);
   if v_event.created_by<>v_actor then raise exception 'Registration decisions are creator-only' using errcode='42501'; end if;
  select * into v_attempt from public.match_event_registration_attempts where id=p_attempt_id and match_event_id=p_match_event_id;
  if not found then raise exception 'MATCH_REGISTRATION_NOT_FOUND' using errcode='P0001'; end if;
   if v_attempt.user_id=v_actor then raise exception 'Creator cannot decide their own registration' using errcode='42501'; end if;
  select * into v_row from public.match_event_registrations where id=v_attempt.registration_id;
  if v_row.current_attempt_id is distinct from p_attempt_id or v_attempt.ended_at is not null then
    raise exception 'MATCH_REGISTRATION_ALREADY_RESOLVED' using errcode='P0001'; end if;
  if v_attempt.outcome='accepted' and p_decision='approve' then
    return jsonb_build_object('event_id',p_match_event_id,'user_id',v_row.user_id,'lifecycle','accepted',
      'participation',v_row.participation_status,'accepted_order',v_attempt.accepted_order,'registration_source',v_attempt.registration_source,
      'approved_at',v_attempt.approved_at,'accepted_at',v_attempt.accepted_at,'replayed',true);
  end if;
  if v_attempt.outcome<>'pending' or v_row.lifecycle<>'pending' then raise exception 'MATCH_REGISTRATION_ALREADY_RESOLVED' using errcode='P0001'; end if;
  v_now:=clock_timestamp();
  if v_now>=v_event.registration_cutoff_at then raise exception 'MATCH_REGISTRATION_CLOSED' using errcode='P0001'; end if;
  if p_decision='approve' then
    select visibility='public' into v_public from public.communities where id=v_event.community_id;
    if (v_row.registration_source='member' and not public.match_registration_is_member(v_event.community_id,v_row.user_id))
      or (v_row.registration_source<>'member' and not v_public) then raise exception 'MATCH_REGISTRATION_REQUESTER_INELIGIBLE' using errcode='P0001'; end if;
    select count(*) into v_count from public.match_event_registrations where match_event_id=p_match_event_id and lifecycle='accepted';
    if v_event.maximum_registrations is not null and v_count>=v_event.maximum_registrations then raise exception 'MATCH_REGISTRATION_FULL' using errcode='P0001'; end if;
    update public.match_event_registration_state set next_accepted_ordinal=next_accepted_ordinal+1 where match_event_id=p_match_event_id returning next_accepted_ordinal-1 into v_order;
     update public.match_event_registrations set lifecycle='accepted',accepted_at=v_now,approved_at=v_now,accepted_order=v_order,
       resolved_at=null,resolved_by=null where id=v_row.id;
    update public.match_event_registration_attempts set outcome='accepted',decided_at=v_now,actor_id=v_actor,
      accepted_at=v_now,approved_at=v_now,accepted_order=v_order where id=p_attempt_id;
    v_result:=public.reconcile_match_registration_participation(p_match_event_id,v_row.id);
    v_status:=(v_result->>'accepted_participation')::public.match_registration_participation;
    perform public.persist_notification(v_row.user_id,'match.registration_approved:'||v_row.id||':'||p_attempt_id,
      'match_registration_approved','matches','match_event',p_match_event_id,v_event.community_id);
    return jsonb_build_object('event_id',p_match_event_id,'user_id',v_row.user_id,'lifecycle','accepted','participation',v_status,
      'accepted_order',v_order,'registration_source',v_row.registration_source,'approved_at',v_now,'accepted_at',v_now,'replayed',false);
  end if;
  update public.match_event_registrations set lifecycle='rejected',resolved_at=v_now,resolved_by=v_actor where id=v_row.id;
  update public.match_event_registration_attempts set outcome='rejected',decided_at=v_now,actor_id=v_actor where id=p_attempt_id;
  perform public.persist_notification(v_row.user_id,'match.registration_rejected:'||v_row.id||':'||p_attempt_id,
    'match_registration_rejected','matches','match_event',p_match_event_id,v_event.community_id);
  return jsonb_build_object('event_id',p_match_event_id,'user_id',v_row.user_id,'lifecycle','rejected',
    'registration_source',v_row.registration_source,'resolved_at',v_now,'resolved_by',v_actor,'replayed',false);
end $$;

-- Ordinals remain immutable evidence; current queue position is separate once
-- departures introduce gaps. Keep notification placement copy truthful.
drop function public.get_my_match_notification_contexts(uuid[]);
create function public.get_my_match_notification_contexts(p_notification_ids uuid[])
returns table(notification_id uuid, match_event_id uuid, creator_display_name text,
  scheduled_at timestamptz, timezone text, venue text, event_type public.match_event_type,
  playing_count integer, reserve_count integer, reserve_not_playing_count integer,
  price_minor bigint, currency text, requester_display_name text,
  caller_participation public.match_registration_participation, caller_accepted_order bigint,
  caller_roster_position integer)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'Authentication required' using errcode='28000'; end if;
  if coalesce(cardinality(p_notification_ids),0)>50 then raise exception 'Page too large' using errcode='22023'; end if;
  return query select n.id,e.id,p.display_name,e.starts_at,e.timezone,e.venue_name,e.event_type,
    c.playing_count,c.reserve_count,c.reserve_not_playing_count,e.price_minor,e.currency,
    rq.display_name,cr.participation_status,cr.accepted_order,cr.roster_position
  from public.notifications n
  join public.match_events e on e.id=n.target_id and e.community_id is not distinct from n.community_id
  left join public.player_profiles p on p.user_id=e.created_by
  cross join lateral public.match_registration_counts(e.id) c
  left join public.match_event_registration_attempts ra on ra.id=(
    case when n.kind='match_registration_requested'
      and n.event_key ~ '^match\.registration_requested:[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}$'
      then split_part(n.event_key,':',3)::uuid end) and ra.match_event_id=e.id
  left join public.player_profiles rq on rq.user_id=ra.user_id
  left join lateral (select q.participation_status,q.accepted_order,q.roster_position
    from public.match_registration_roster(e.id) q where q.user_id=auth.uid()) cr on true
  where n.id=any(coalesce(p_notification_ids,'{}'::uuid[])) and n.recipient_user_id=auth.uid()
    and n.category='matches' and n.target_type='match_event'
    and n.kind in ('match_event_published','match_event_invitation','match_registration_requested','match_registration_approved','match_registration_rejected','match_registration_playing','match_registration_reserve','match_registration_promoted','match_registration_quartet_complete','match_registration_expired','match_registration_not_playing','match_invitation_accepted','match_invitation_declined','match_invitation_expired','match_registration_withdrawn','match_registration_removed','match_registration_group_changed')
    and public.can_read_match_event(e.id);
end $$;
revoke all on function public.get_my_match_notification_contexts(uuid[]) from public,anon,authenticated;
grant execute on function public.get_my_match_notification_contexts(uuid[]) to authenticated;

-- Preserve the reader contracts and authorization while extending both lists.
do $$
declare v_signature text; v_definition text;
begin
  foreach v_signature in array array[
    'public.get_my_notification_target_v2(uuid)',
    'public.get_my_match_notification_contexts(uuid[])'] loop
    v_definition:=pg_get_functiondef(v_signature::regprocedure);
     v_definition:=replace(v_definition,'''match_invitation_expired'')',
       '''match_invitation_expired'',''match_registration_withdrawn'',''match_registration_removed'',''match_registration_group_changed'')');
     if position('match_registration_group_changed' in v_definition)=0 then
       raise exception 'Notification reader allowlist was not extended: %',v_signature;
     end if;
    execute v_definition;
  end loop;
end $$;

create or replace function public.get_my_match_registration(p_match_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then
    raise exception 'Authentication required' using errcode='28000'; end if;
  select jsonb_build_object('event_id',e.id,
    'lifecycle',case when r.lifecycle='pending' and (e.registration_cutoff_at<=now() or s.cutoff_processed_at is not null)
      then 'expired'::public.match_registration_lifecycle else r.lifecycle end,
    'participation',q.participation_status,'accepted_order',r.accepted_order,'position',q.roster_position,
    'registration_source',r.registration_source,'requested_at',r.requested_at,'approved_at',r.approved_at,
    'accepted_at',r.accepted_at,'resolved_at',r.resolved_at,'attempt_id',r.current_attempt_id,
    'left_at',r.left_at,'removal_reason',r.removal_reason)
  into v_result from public.match_events e
  left join public.match_event_registration_state s on s.match_event_id=e.id
  left join public.match_event_registrations r on r.match_event_id=e.id and r.user_id=auth.uid()
  left join lateral (select * from public.match_registration_roster(e.id) x where x.user_id=auth.uid()) q on true
  where e.id=p_match_event_id and (r.id is not null or public.can_read_match_event(e.id));
  return v_result;
end $$;

commit;
