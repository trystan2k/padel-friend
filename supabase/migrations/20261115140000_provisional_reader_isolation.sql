begin;

-- Reader predicates must reject the actor before any creator, accepted-registration
-- or historical-team branch. is_provisional_actor also rejects revoked pre-claim JWTs.
-- Keep the options object's existing empty/null shape without exposing rating defaults.
create or replace function public.get_match_creation_options(p_community_id uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when (select auth.uid()) is null
      or coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') = 'true'
      or public.is_provisional_actor()
    then jsonb_build_object('communities', '[]'::jsonb, 'level_defaults', null, 'saved_venues', '[]'::jsonb)
    else jsonb_build_object(
      'communities', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'name', c.name,
          'timezone', public.get_effective_community_admin_defaults(c.settings) ->> 'timezone',
          'currency', coalesce(c.settings ->> 'currency', 'EUR')))
        from public.communities c
        where public.is_community_member(c.id)
          and (p_community_id is null or c.id = p_community_id)
      ), '[]'::jsonb),
      'level_defaults', (
        select case when r.display_level is null
          then jsonb_build_object('min', null, 'max', null, 'level', null)
          else jsonb_build_object(
            'min', greatest(0, r.display_level - 0.5),
            'max', least(7, r.display_level + 1.5), 'level', r.display_level)
          end
        from public.global_player_ratings r where r.user_id = (select auth.uid())
      ),
      'saved_venues', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', v.id, 'name', v.name, 'photo_path', v.photo_path, 'maps_url', v.maps_url)
          order by v.name, v.id)
        from public.community_venues v
        where p_community_id is not null and v.community_id = p_community_id
          and v.archived_at is null and public.is_community_member(v.community_id)
      ), '[]'::jsonb))
    end
$$;

create or replace function public.result_amendment_reader(
  p_match_event_id uuid, p_proposal_id uuid, p_base_version bigint
) returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true'
    and not public.is_provisional_actor()
    and exists (
      select 1 from public.match_events e
       where e.id = p_match_event_id
         and (
           e.created_by = (select auth.uid())
           or public.is_community_admin(e.community_id)
           or exists (
             select 1 from public.match_event_registrations r
              where r.match_event_id = e.id and r.user_id = (select auth.uid())
                and r.lifecycle = 'accepted' and r.cancelled_at is null)
           or exists (
             select 1 from public.match_event_result_proposal_versions v
              where v.proposal_id = p_proposal_id and v.version = p_base_version
                and (v.teams -> 'team_a' ? (select auth.uid())::text
                  or v.teams -> 'team_b' ? (select auth.uid())::text))
         ));
$$;

create or replace function public.result_dispute_event_reader(p_match_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true'
    and not public.is_provisional_actor()
    and exists (
      select 1 from public.match_events e
       where e.id = p_match_event_id
         and (
           e.created_by = (select auth.uid())
           or public.is_community_admin(e.community_id)
           or exists (
             select 1 from public.match_event_registrations r
              where r.match_event_id = e.id and r.user_id = (select auth.uid())
                and r.lifecycle = 'accepted' and r.cancelled_at is null)
           or exists (
             select 1 from public.result_amendment_requests q
               join public.match_event_result_proposal_versions v
                 on v.proposal_id = q.proposal_id and v.version = q.base_version
              where q.match_event_id = e.id
                and (v.teams -> 'team_a' ? (select auth.uid())::text
                  or v.teams -> 'team_b' ? (select auth.uid())::text))
         ));
$$;

revoke execute on function public.get_match_creation_options(uuid),
  public.result_amendment_reader(uuid, uuid, bigint),
  public.result_dispute_event_reader(uuid) from public, anon, authenticated;
grant execute on function public.get_match_creation_options(uuid),
  public.result_amendment_reader(uuid, uuid, bigint),
  public.result_dispute_event_reader(uuid) to authenticated;

commit;
