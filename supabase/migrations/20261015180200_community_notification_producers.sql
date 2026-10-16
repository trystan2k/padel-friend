create or replace function public.notify_community_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.invitee_user_id is not null
    and new.redeemed_at is null
    and new.revoked_at is null
    and new.expires_at > pg_catalog.now() then
    perform public.persist_notification(
      p_recipient_user_id := new.invitee_user_id,
      p_event_key := 'community.invitation:' || new.id::text,
      p_kind := 'community_invitation',
      p_category := 'community',
      p_target_type := 'community_invitation',
      p_target_id := new.id,
      p_community_id := new.community_id
    );
  end if;
  return new;
end;
$$;

create trigger community_invitation_notification
after insert on public.community_invitations
for each row execute function public.notify_community_invitation();

create or replace function public.notify_community_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_key text;
  v_kind text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status = 'pending' and new.status = 'active' then
    v_event_key := 'community.membership_approved:' || new.id::text;
    v_kind := 'community_membership_approved';
  elsif old.status = 'pending' and new.status = 'inactive' then
    v_event_key := 'community.membership_denied:' || new.id::text;
    v_kind := 'community_membership_denied';
  elsif old.status = 'active' and new.status = 'inactive'
    and (select auth.uid()) is not null
    and (select auth.uid()) <> new.user_id then
    v_event_key := 'community.membership_removed:' || new.id::text;
    v_kind := 'community_membership_removed';
  else
    return new;
  end if;

  perform public.persist_notification(
    p_recipient_user_id := new.user_id,
    p_event_key := v_event_key,
    p_kind := v_kind,
    p_category := 'community',
    p_target_type := 'community_membership',
    p_target_id := new.id,
    p_community_id := new.community_id
  );
  return new;
end;
$$;

create trigger community_membership_notification
after update of status on public.community_members
for each row execute function public.notify_community_membership();

revoke all on function public.notify_community_invitation() from public, anon, authenticated;
revoke all on function public.notify_community_membership() from public, anon, authenticated;
