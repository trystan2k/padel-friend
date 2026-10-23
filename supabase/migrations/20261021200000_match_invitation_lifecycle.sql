begin;

create type public.match_invitation_status as enum ('pending', 'accepted', 'declined', 'expired', 'cancelled');
alter table public.match_event_invites
  add column status public.match_invitation_status not null default 'pending',
  add column responded_at timestamptz,
  add column responded_by uuid references auth.users(id) on delete restrict,
  add column expired_at timestamptz,
  add column submission_result jsonb check (jsonb_typeof(submission_result) = 'object');

-- Backfill before installing the terminal guard; never produce historical effects.
drop trigger match_invite_immutable on public.match_event_invites;
update public.match_event_invites i set
  status = 'accepted', responded_at = r.accepted_at, responded_by = i.invitee_user_id,
  submission_result = jsonb_build_object('event_id', i.match_event_id, 'user_id', i.invitee_user_id,
    'lifecycle', r.lifecycle, 'participation', r.participation_status,
    'accepted_order', r.accepted_order, 'registration_source', r.registration_source,
    'requested_at', r.requested_at, 'approved_at', r.approved_at, 'accepted_at', r.accepted_at,
    'already_registered', false)
from public.match_event_registrations r
where r.match_event_id = i.match_event_id and r.user_id = i.invitee_user_id and r.lifecycle = 'accepted';
update public.match_event_invites i set status = 'expired', expired_at = e.registration_cutoff_at
from public.match_events e where e.id = i.match_event_id and i.status = 'pending'
  and e.registration_cutoff_at <= clock_timestamp();
alter table public.match_event_invites add constraint match_invitation_resolution_shape check (
  (status = 'pending' and responded_at is null and responded_by is null and expired_at is null and submission_result is null)
  or (status in ('accepted', 'declined') and responded_at is not null and responded_by is not null and responded_by = invitee_user_id and expired_at is null
    and ((status = 'accepted' and submission_result is not null) or (status = 'declined' and submission_result is null)))
  or (status = 'expired' and expired_at is not null and responded_at is null and responded_by is null and submission_result is null)
  or (status = 'cancelled' and responded_at is not null and responded_by is not null and expired_at is null and submission_result is null));
create index match_event_invites_pending on public.match_event_invites(match_event_id, id) where status = 'pending';

create function public.guard_match_invitation_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Invitation identity is immutable' using errcode = '23514'; end if;
  if (new.id, new.match_event_id, new.invitee_user_id, new.invited_by, new.created_at)
    is distinct from (old.id, old.match_event_id, old.invitee_user_id, old.invited_by, old.created_at)
    or old.status <> 'pending' then
    raise exception 'Invitation identity and terminal resolution are immutable' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger match_invite_immutable before update or delete on public.match_event_invites
for each row execute function public.guard_match_invitation_mutation();

-- Common lock chain, including publication's existing advisory key. Lock all
-- ledger rows in order here so callers cannot invert registrations/attempts/invites.
create or replace function public.lock_match_event_registration(p_event_id uuid)
returns public.match_events language plpgsql security definer set search_path = '' as $$
declare v_community uuid; v_event public.match_events%rowtype;
begin
  select e.community_id into v_community from public.match_events e where e.id = p_event_id;
  if v_community is null then raise exception 'MATCH_REGISTRATION_EVENT_NOT_FOUND' using errcode = 'P0001'; end if;
  perform 1 from public.communities c where c.id = v_community for update;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_event_id::text, 73073));
  select * into v_event from public.match_events e where e.id = p_event_id for update;
  insert into public.match_event_registration_state(match_event_id, next_accepted_ordinal)
    select p_event_id, coalesce(max(r.accepted_order), 0) + 1 from public.match_event_registrations r
    where r.match_event_id = p_event_id on conflict (match_event_id) do nothing;
  perform 1 from public.match_event_registration_state s where s.match_event_id = p_event_id for update;
  perform 1 from public.match_event_registrations r where r.match_event_id = p_event_id order by r.id for update;
  perform 1 from public.match_event_registration_attempts a where a.match_event_id = p_event_id order by a.id for update;
  perform 1 from public.match_event_invites i where i.match_event_id = p_event_id order by i.id for update;
  return v_event;
end $$;

create or replace function public.lock_match_event_registration_skip_locked(p_event_id uuid)
returns public.match_events language plpgsql security definer set search_path = '' as $$
declare v_community uuid; v_event public.match_events%rowtype;
begin
  select e.community_id into v_community from public.match_events e where e.id = p_event_id;
  if v_community is null then raise exception 'MATCH_REGISTRATION_EVENT_NOT_FOUND' using errcode = 'P0001'; end if;
  -- Subtransaction releases earlier locks when any later acquisition fails.
  begin
    perform 1 from public.communities c where c.id = v_community for update nowait;
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(p_event_id::text, 73073)) then
      raise lock_not_available;
    end if;
    select * into v_event from public.match_events e where e.id = p_event_id for update nowait;
    insert into public.match_event_registration_state(match_event_id, next_accepted_ordinal)
      select p_event_id, coalesce(max(r.accepted_order), 0) + 1 from public.match_event_registrations r
      where r.match_event_id = p_event_id on conflict (match_event_id) do nothing;
    perform 1 from public.match_event_registration_state s where s.match_event_id = p_event_id for update nowait;
    perform 1 from public.match_event_registrations r where r.match_event_id = p_event_id order by r.id for update nowait;
    perform 1 from public.match_event_registration_attempts a where a.match_event_id = p_event_id order by a.id for update nowait;
    perform 1 from public.match_event_invites i where i.match_event_id = p_event_id order by i.id for update nowait;
  exception when lock_not_available then return null;
  end;
  return v_event;
end $$;

-- Owner-only seam. The caller must hold the canonical event lock. No client
-- execute grant; actor/capacity/eligibility/ordinal always come from trusted SQL.
create function public.submit_match_registration_locked(p_match_event_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event public.match_events%rowtype;
  v_row public.match_event_registrations%rowtype;
  v_invite public.match_event_invites%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_member boolean; v_public boolean; v_rating numeric; v_accepted boolean;
  v_source public.match_registration_source;
  v_lifecycle public.match_registration_lifecycle;
  v_participation public.match_registration_participation;
  v_order bigint; v_count integer; v_id uuid; v_attempt uuid;
  v_result jsonb; v_reconcile jsonb;
begin
  select * into v_event from public.match_events e where e.id = p_match_event_id;
  if v_now >= v_event.registration_cutoff_at then raise exception 'MATCH_REGISTRATION_CLOSED' using errcode = 'P0001'; end if;
  select * into v_invite from public.match_event_invites i
    where i.match_event_id = p_match_event_id and i.invitee_user_id = p_actor_id;
  if v_event.visibility <> 'community_open' and (v_invite.id is null or v_invite.status not in ('pending', 'accepted')) then
    raise exception 'MATCH_REGISTRATION_INVITE_ONLY' using errcode = 'P0001';
  end if;
  v_member := public.match_registration_is_member(v_event.community_id, p_actor_id);
  select r.display_level into v_rating from public.global_player_ratings r where r.user_id = p_actor_id;
  select c.visibility = 'public' into v_public from public.communities c where c.id = v_event.community_id;
  if v_member then
    v_accepted := not v_event.restriction_enabled or (v_rating is not null and v_rating between v_event.min_level and v_event.max_level);
    v_source := 'member';
  elsif v_public then v_accepted := false; v_source := 'guest';
  else raise exception 'MATCH_REGISTRATION_DENIED' using errcode = 'P0001'; end if;
  select * into v_row from public.match_event_registrations r where r.match_event_id = p_match_event_id and r.user_id = p_actor_id;
  if v_row.lifecycle = 'accepted' then raise exception 'MATCH_REGISTRATION_DUPLICATE' using errcode = 'P0001'; end if;
  if v_row.lifecycle = 'pending' then raise exception 'MATCH_REGISTRATION_PENDING_DUPLICATE' using errcode = 'P0001'; end if;
  if v_accepted then
    select count(*) into v_count from public.match_event_registrations r where r.match_event_id = p_match_event_id and r.lifecycle = 'accepted';
    if v_event.maximum_registrations is not null and v_count >= v_event.maximum_registrations then
      raise exception 'MATCH_REGISTRATION_FULL' using errcode = 'P0001';
    end if;
    update public.match_event_registration_state s set next_accepted_ordinal = next_accepted_ordinal + 1
      where s.match_event_id = p_match_event_id returning next_accepted_ordinal - 1 into v_order;
    v_lifecycle := 'accepted'; v_participation := 'reserve';
  else v_lifecycle := 'pending'; end if;
  if v_row.id is not null then
    update public.match_event_registrations r set lifecycle = v_lifecycle,
      accepted_at = case when v_accepted then v_now end, approved_at = null, accepted_order = v_order,
      participation_status = v_participation, registration_source = v_source, requested_at = v_now,
      resolved_at = null, resolved_by = null where r.id = v_row.id returning id into v_id;
  else
    insert into public.match_event_registrations(match_event_id, user_id, lifecycle, accepted_at, accepted_order,
      participation_status, registration_source, requested_at)
      values (p_match_event_id, p_actor_id, v_lifecycle, case when v_accepted then v_now end, v_order, v_participation, v_source, v_now)
      returning id into v_id;
  end if;
  insert into public.match_event_registration_attempts(match_event_id, user_id, requested_at, decided_at, outcome, actor_id)
    values (p_match_event_id, p_actor_id, v_now, case when v_accepted then v_now end, v_lifecycle, case when v_accepted then p_actor_id end)
    returning id into v_attempt;
  if v_accepted then
    v_reconcile := public.reconcile_match_registration_participation(p_match_event_id, v_id);
    v_participation := (v_reconcile ->> 'accepted_participation')::public.match_registration_participation;
  else
    perform public.persist_notification(v_event.created_by, 'match.registration_requested:' || v_id::text || ':' || v_attempt::text,
      'match_registration_requested', 'matches', 'match_event', p_match_event_id, v_event.community_id);
  end if;
  v_result := jsonb_build_object('event_id', p_match_event_id, 'user_id', p_actor_id, 'lifecycle', v_lifecycle,
    'participation', v_participation, 'accepted_order', v_order, 'registration_source', v_source,
    'requested_at', v_now, 'approved_at', null, 'accepted_at', case when v_accepted then v_now end, 'already_registered', false);
  if v_invite.status = 'pending' then
    update public.match_event_invites set status = 'accepted', responded_at = v_now, responded_by = p_actor_id,
      submission_result = v_result where id = v_invite.id;
    perform public.persist_notification(v_event.created_by, 'match.invitation_accepted:' || v_invite.id::text,
      'match_invitation_accepted', 'matches', 'match_event', p_match_event_id, v_event.community_id);
  end if;
  return v_result;
end $$;

create or replace function public.submit_match_registration(p_match_event_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  perform public.lock_match_event_registration(p_match_event_id);
  return public.submit_match_registration_locked(p_match_event_id, v_actor);
end $$;

create function public.expire_match_event_invitations_locked(p_event_id uuid, p_as_of timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_event public.match_events%rowtype; v_invite record; v_count integer := 0; v_user uuid;
begin
  select * into v_event from public.match_events e where e.id = p_event_id;
  if p_as_of is null or p_as_of < v_event.registration_cutoff_at then return 0; end if;
  for v_invite in select i.id, i.invitee_user_id from public.match_event_invites i
    where i.match_event_id = p_event_id and i.status = 'pending' order by i.id
  loop
    update public.match_event_invites set status = 'expired', expired_at = p_as_of where id = v_invite.id;
    for v_user in select distinct x from unnest(array[v_event.created_by, v_invite.invitee_user_id]) x loop
      perform public.persist_notification(v_user, 'match.invitation_expired:' || v_invite.id::text,
        'match_invitation_expired', 'matches', 'match_event', p_event_id, v_event.community_id);
    end loop;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create function public.get_my_match_invitation(p_match_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select jsonb_build_object('invitation_id', i.id, 'status', i.status,
    'effective_status', case when i.status = 'pending' and e.registration_cutoff_at <= now() then 'expired' else i.status::text end,
    'expires_at', e.registration_cutoff_at, 'responded_at', i.responded_at)
    into v_result from public.match_event_invites i join public.match_events e on e.id = i.match_event_id
    where e.id = p_match_event_id and i.invitee_user_id = auth.uid() and public.can_read_match_event(e.id);
  return v_result;
end $$;

create function public.respond_match_event_invitation(p_match_event_id uuid, p_invitation_id uuid, p_response text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_event public.match_events%rowtype; v_invite public.match_event_invites%rowtype;
  v_now timestamptz; v_result jsonb; v_replayed boolean := false;
begin
  if v_actor is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_response is null or p_response not in ('accept', 'decline') or p_invitation_id is null then
    raise exception 'Invalid invitation response' using errcode = '22023';
  end if;
  v_event := public.lock_match_event_registration(p_match_event_id);
  v_now := clock_timestamp();
  select * into v_invite from public.match_event_invites i where i.id = p_invitation_id
    and i.match_event_id = p_match_event_id and i.invitee_user_id = v_actor;
  if not found then raise exception 'MATCH_INVITATION_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_invite.status = 'pending' and v_now >= v_event.registration_cutoff_at then
    perform public.expire_match_event_invitations_locked(p_match_event_id, v_now);
    v_invite.status := 'expired';
  elsif v_invite.status = 'pending' then
    if p_response = 'accept' then
      begin
        v_result := public.submit_match_registration_locked(p_match_event_id, v_actor);
        v_invite.status := 'accepted';
      exception when raise_exception then
        -- The helper takes its own post-lock clock. A boundary crossed between
        -- the response check and entry must still commit expiry, not roll it back.
        if sqlerrm <> 'MATCH_REGISTRATION_CLOSED' then raise; end if;
        perform public.expire_match_event_invitations_locked(p_match_event_id, clock_timestamp());
        v_invite.status := 'expired';
      end;
    else
      update public.match_event_invites set status = 'declined', responded_at = v_now, responded_by = v_actor where id = v_invite.id;
      v_invite.status := 'declined';
      perform public.persist_notification(v_event.created_by, 'match.invitation_declined:' || v_invite.id::text,
        'match_invitation_declined', 'matches', 'match_event', p_match_event_id, v_event.community_id);
    end if;
  elsif (v_invite.status = 'accepted' and p_response = 'accept') or (v_invite.status = 'declined' and p_response = 'decline') then
    v_replayed := true; v_result := v_invite.submission_result;
  elsif v_invite.status <> 'expired' then
    raise exception 'MATCH_INVITATION_ALREADY_RESOLVED' using errcode = 'P0001';
  else v_replayed := true;
  end if;
  return jsonb_build_object('event_id', p_match_event_id, 'invitation_id', v_invite.id,
    'status', v_invite.status, 'registration', v_result, 'replayed', v_replayed);
end $$;

-- Separate creator-only seam; never broaden the public accepted-roster DTO.
create function public.list_match_event_invitations(p_match_event_id uuid)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  return query select jsonb_build_object('invitation_id', i.id, 'invitee_user_id', i.invitee_user_id,
    'status', i.status, 'effective_status', case when i.status = 'pending' and e.registration_cutoff_at <= now() then 'expired' else i.status::text end,
    'expires_at', e.registration_cutoff_at, 'responded_at', i.responded_at)
    from public.match_event_invites i join public.match_events e on e.id = i.match_event_id
    where e.id = p_match_event_id and e.created_by = auth.uid() order by i.created_at, i.id;
end $$;

create or replace function public.process_match_event_registration_cutoff(p_match_event_id uuid, p_skip_locked boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_event public.match_events%rowtype; v_now timestamptz; v_processed_at timestamptz;
  v_reconcile jsonb; v_revision bigint; v_users uuid[]; v_uid uuid; v_invites integer;
begin
  if p_skip_locked then
    v_event := public.lock_match_event_registration_skip_locked(p_match_event_id);
    if v_event.id is null then return jsonb_build_object('event_id', p_match_event_id, 'processed', false, 'reason', 'locked'); end if;
  else v_event := public.lock_match_event_registration(p_match_event_id); end if;
  v_now := clock_timestamp();
  if v_now < v_event.registration_cutoff_at then
    return jsonb_build_object('event_id', p_match_event_id, 'processed', false, 'reason', 'not_due');
  end if;
  select s.cutoff_processed_at into v_processed_at from public.match_event_registration_state s where s.match_event_id = p_match_event_id;
  if v_processed_at is not null then
    return jsonb_build_object('event_id', p_match_event_id, 'processed', false, 'reason', 'already_processed');
  end if;
  select coalesce(array_agg(r.user_id), '{}'::uuid[]) into v_users from public.match_event_registrations r
    where r.match_event_id = p_match_event_id and r.lifecycle = 'pending';
  update public.match_event_registrations set lifecycle = 'expired', resolved_at = v_now, resolved_by = null
    where match_event_id = p_match_event_id and lifecycle = 'pending';
  update public.match_event_registration_attempts set outcome = 'expired', decided_at = v_now, actor_id = null
    where match_event_id = p_match_event_id and outcome = 'pending';
  v_invites := public.expire_match_event_invitations_locked(p_match_event_id, v_now);
  v_reconcile := public.reconcile_match_registration_participation(p_match_event_id);
  v_revision := (v_reconcile ->> 'transition_revision')::bigint;
  foreach v_uid in array v_users loop
    perform public.persist_notification(v_uid,
      'match.cutoff_expired:' || p_match_event_id::text || ':' || v_revision::text || ':' || v_uid::text,
      'match_registration_expired', 'matches', 'match_event', p_match_event_id, v_event.community_id);
  end loop;
  update public.match_event_registration_state set cutoff_processed_at = v_now where match_event_id = p_match_event_id;
  return jsonb_build_object('event_id', p_match_event_id, 'processed', true, 'reason', 'processed',
    'expired_count', cardinality(v_users), 'expired_invitation_count', v_invites,
    'accepted_count', (v_reconcile ->> 'accepted_count')::integer, 'playing_count', (v_reconcile ->> 'playing_count')::integer,
    'reserve_count', (v_reconcile ->> 'reserve_count')::integer,
    'reserve_not_playing_count', (v_reconcile ->> 'reserve_not_playing_count')::integer, 'transition_revision', v_revision);
end $$;

create or replace function public.get_my_notification_target_v2(p_notification_id uuid)
returns table(target_status text, community_id uuid, community_name text, invitation_id uuid,
  membership_status text, match_event_id uuid, match_available boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_n public.notifications%rowtype; v_old record;
begin
  if v_actor is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  select n.* into v_n from public.notifications n where n.id=p_notification_id and n.recipient_user_id=v_actor;
  if not found then raise exception 'Notification unavailable' using errcode='42501'; end if;
  if v_n.kind in ('match_event_published','match_event_invitation','match_registration_requested','match_registration_approved','match_registration_rejected','match_registration_playing','match_registration_reserve','match_registration_promoted','match_registration_quartet_complete','match_registration_expired','match_registration_not_playing','match_invitation_accepted','match_invitation_declined','match_invitation_expired')
    and v_n.category='matches' and v_n.target_type='match_event' then
    if exists(select 1 from public.match_events e where e.id=v_n.target_id
      and e.community_id is not distinct from v_n.community_id and public.can_read_match_event(e.id)) then
      return query select 'match_available', null::uuid, null::text, null::uuid, null::text, v_n.target_id, true;
    else return query select 'unavailable', null::uuid, null::text, null::uuid, null::text, null::uuid, false; end if;
    return;
  end if;
  select * into v_old from public.get_my_notification_target(p_notification_id);
  return query select v_old.target_status, v_old.community_id, v_old.community_name,
    v_old.invitation_id, v_old.membership_status, null::uuid, false;
end $$;

create or replace function public.get_my_match_notification_contexts(p_notification_ids uuid[])
returns table(notification_id uuid, match_event_id uuid, creator_display_name text,
  scheduled_at timestamptz, timezone text, venue text, event_type public.match_event_type,
  playing_count integer, reserve_count integer, reserve_not_playing_count integer,
  price_minor bigint, currency text, requester_display_name text,
  caller_participation public.match_registration_participation, caller_accepted_order bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'Authentication required' using errcode='28000'; end if;
  if coalesce(cardinality(p_notification_ids),0)>50 then raise exception 'Page too large' using errcode='22023'; end if;
  return query
  select n.id,e.id,p.display_name,e.starts_at,e.timezone,e.venue_name,e.event_type,
    c.playing_count,c.reserve_count,c.reserve_not_playing_count,e.price_minor,e.currency,
    rq.display_name,cr.participation_status,cr.accepted_order
  from public.notifications n
  join public.match_events e on e.id=n.target_id and e.community_id is not distinct from n.community_id
  left join public.player_profiles p on p.user_id=e.created_by
  cross join lateral public.match_registration_counts(e.id) c
  left join public.match_event_registration_attempts ra on ra.id = (
    case when n.kind='match_registration_requested'
      and n.event_key ~ '^match\.registration_requested:[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}$'
      then pg_catalog.split_part(n.event_key,':',3)::uuid end) and ra.match_event_id=e.id
  left join public.player_profiles rq on rq.user_id=ra.user_id
  left join lateral (select q.participation_status, q.accepted_order from public.match_registration_roster(e.id) q
    where q.user_id=(select auth.uid())) cr on true
  where n.id=any(coalesce(p_notification_ids,'{}'::uuid[])) and n.recipient_user_id=auth.uid()
    and n.category='matches' and n.target_type='match_event'
    and n.kind in ('match_event_published','match_event_invitation','match_registration_requested','match_registration_approved','match_registration_rejected','match_registration_playing','match_registration_reserve','match_registration_promoted','match_registration_quartet_complete','match_registration_expired','match_registration_not_playing','match_invitation_accepted','match_invitation_declined','match_invitation_expired')
    and public.can_read_match_event(e.id);
end $$;

revoke all on function public.guard_match_invitation_mutation(),
  public.submit_match_registration_locked(uuid, uuid), public.expire_match_event_invitations_locked(uuid, timestamptz),
  public.get_my_match_invitation(uuid), public.list_match_event_invitations(uuid), public.respond_match_event_invitation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.get_my_match_invitation(uuid), public.list_match_event_invitations(uuid), public.respond_match_event_invitation(uuid, uuid, text) to authenticated;

commit;
