create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  push_enabled boolean not null default false,
  push_community boolean not null default true,
  push_matches boolean not null default true,
  push_results boolean not null default true,
  push_rankings boolean not null default true,
  push_leagues boolean not null default true,
  critical_in_app_enabled boolean not null default true check (critical_in_app_enabled),
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon, authenticated;
grant select (user_id, push_enabled, push_community, push_matches, push_results, push_rankings, push_leagues, critical_in_app_enabled, updated_at)
  on public.notification_preferences to authenticated;
create policy notification_preferences_read on public.notification_preferences
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select auth.uid()) is not null
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );

create or replace function public.set_my_notification_preferences(
  p_push_enabled boolean,
  p_push_community boolean,
  p_push_matches boolean,
  p_push_results boolean,
  p_push_rankings boolean,
  p_push_leagues boolean
) returns public.notification_preferences
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_preferences public.notification_preferences;
begin
  if p_push_enabled is null or p_push_community is null or p_push_matches is null
    or p_push_results is null or p_push_rankings is null or p_push_leagues is null then
    raise exception using errcode = '22004', message = 'Notification preferences cannot be null';
  end if;
  if (select auth.uid()) is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  insert into public.notification_preferences (
    user_id, push_enabled, push_community, push_matches, push_results, push_rankings, push_leagues,
    critical_in_app_enabled
  ) values (
    (select auth.uid()), p_push_enabled, p_push_community, p_push_matches, p_push_results,
    p_push_rankings, p_push_leagues, true
  )
  on conflict (user_id) do update set
    push_enabled = excluded.push_enabled,
    push_community = excluded.push_community,
    push_matches = excluded.push_matches,
    push_results = excluded.push_results,
    push_rankings = excluded.push_rankings,
    push_leagues = excluded.push_leagues,
    critical_in_app_enabled = true,
    updated_at = now()
  returning * into v_preferences;

  return v_preferences;
end;
$function$;
revoke execute on function public.set_my_notification_preferences(boolean, boolean, boolean, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.set_my_notification_preferences(boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;
