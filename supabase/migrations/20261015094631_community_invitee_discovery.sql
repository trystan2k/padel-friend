begin;

create table public.community_invitee_directory_preferences (
  user_id uuid primary key references public.player_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.community_invitee_directory_preferences enable row level security;
revoke all on public.community_invitee_directory_preferences from public, anon, authenticated;
grant select, insert, delete on public.community_invitee_directory_preferences to authenticated;
create policy invitee_preferences_owner_select on public.community_invitee_directory_preferences for select to authenticated using (user_id = (select auth.uid()) and coalesce(auth.jwt()->>'is_anonymous', 'false') <> 'true');
create policy invitee_preferences_owner_insert on public.community_invitee_directory_preferences for insert to authenticated with check (user_id = (select auth.uid()) and coalesce(auth.jwt()->>'is_anonymous', 'false') <> 'true');
create policy invitee_preferences_owner_delete on public.community_invitee_directory_preferences for delete to authenticated using (user_id = (select auth.uid()) and coalesce(auth.jwt()->>'is_anonymous', 'false') <> 'true');

create function public.search_community_invitees(p_community_id uuid, p_query text, p_limit integer default 20)
returns table(user_id uuid, display_name text)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then raise exception using errcode = '28000'; end if;
  if p_query is null or char_length(p_query) not between 3 and 80 or p_limit is null or p_limit not between 1 and 20 then raise exception using errcode = '22023'; end if;
  if not exists (
    select 1 from public.communities c join public.community_members m on m.community_id=c.id
    where c.id=p_community_id and c.visibility='private' and m.user_id=v_actor and m.role='admin' and m.status='active' and m.valid_until is null and m.valid_from <= now()
  ) then raise exception using errcode = '42501'; end if;
  return query select p.user_id,p.display_name from public.player_profiles p
    join public.community_invitee_directory_preferences d on d.user_id=p.user_id
    where p.user_id <> v_actor and pg_catalog.strpos(pg_catalog.lower(p.display_name), pg_catalog.lower(p_query)) > 0
    and not exists(select 1 from public.community_members m where m.user_id=p.user_id and m.community_id=p_community_id)
    and not exists(select 1 from public.community_invitations i where i.invitee_user_id=p.user_id and i.community_id=p_community_id and i.revoked_at is null and i.redeemed_at is null and i.expires_at > now())
    order by p.display_name,p.user_id limit p_limit;
end; $$;
revoke all on function public.search_community_invitees(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.search_community_invitees(uuid,text,integer) to authenticated;
commit;
