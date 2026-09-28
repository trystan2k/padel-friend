create table public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80 and display_name = btrim(display_name)),
  avatar_url text check (avatar_url is null or (char_length(avatar_url) <= 256 and avatar_url like user_id::text || '/%')),
  preferred_side text not null check (preferred_side in ('LEFT', 'RIGHT', 'EITHER')),
  dominant_hand text check (dominant_hand in ('LEFT', 'RIGHT')),
  bio text check (char_length(bio) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.global_player_ratings (
  user_id uuid primary key references public.player_profiles(user_id) on delete cascade,
  initial_display_level numeric(3,1) not null check (initial_display_level between 0.0 and 7.0),
  mu numeric(4,2) not null check (mu between 0.00 and 7.00),
  sigma numeric(3,2) not null check (sigma > 0.00 and sigma <= 7.00),
  display_level numeric(4,2) not null check (display_level between 0.00 and 7.00),
  reliability_percent smallint not null check (reliability_percent between 0 and 100),
  confirmed_competitive_game_groups integer not null check (confirmed_competitive_game_groups >= 0),
  highest_display_level numeric(4,2) not null check (highest_display_level between 0.00 and 7.00),
  last_rating_at timestamptz,
  rating_engine text not null check (char_length(rating_engine) between 1 and 64),
  rating_engine_version text not null check (char_length(rating_engine_version) between 1 and 32),
  updated_at timestamptz not null default now(),
  constraint highest_not_below_current check (highest_display_level >= display_level)
);

create function public.touch_player_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger player_profiles_touch_updated_at before update on public.player_profiles
  for each row execute function public.touch_player_updated_at();
create trigger global_player_ratings_touch_updated_at before update on public.global_player_ratings
  for each row execute function public.touch_player_updated_at();

alter table public.player_profiles enable row level security;
alter table public.global_player_ratings enable row level security;
revoke all on public.player_profiles, public.global_player_ratings from public, anon, authenticated;
grant select on public.player_profiles, public.global_player_ratings to authenticated;
grant update (display_name, avatar_url, preferred_side, dominant_hand, bio)
  on public.player_profiles to authenticated;
-- Owners can update avatar_url directly; the verified finalize server path remains preferred.
create policy "player profile owner select" on public.player_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "player profile owner update" on public.player_profiles
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "global rating owner select" on public.global_player_ratings
  for select to authenticated using ((select auth.uid()) = user_id);

create function public.onboard_player(p_display_name text, p_preferred_side text, p_initial_level numeric,
  p_dominant_hand text default null, p_bio text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_display_name is null or char_length(pg_catalog.btrim(p_display_name)) not between 1 and 80
    or p_display_name <> pg_catalog.btrim(p_display_name)
    or p_display_name ~ '^[[:space:]]|[[:space:]]$'
    or p_preferred_side is null or p_preferred_side not in ('LEFT','RIGHT','EITHER')
    or (p_dominant_hand is not null and p_dominant_hand not in ('LEFT','RIGHT'))
    or (p_bio is not null and char_length(p_bio) > 280)
    or p_initial_level is null or p_initial_level < 0 or p_initial_level > 7
    or p_initial_level * 10 <> pg_catalog.trunc(p_initial_level * 10) then
    raise exception 'Invalid onboarding input' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
  if exists (select 1 from public.player_profiles where user_id = v_user_id)
    or exists (select 1 from public.global_player_ratings where user_id = v_user_id) then
    if exists (select 1 from public.player_profiles where user_id = v_user_id)
      and exists (select 1 from public.global_player_ratings where user_id = v_user_id) then
      return;
    end if;
    raise exception 'Incomplete player state' using errcode = '23514';
  end if;
  insert into public.player_profiles (user_id, display_name, preferred_side, dominant_hand, bio)
    values (v_user_id, p_display_name, p_preferred_side, p_dominant_hand, p_bio);
  insert into public.global_player_ratings
    (user_id, initial_display_level, mu, sigma, display_level,
     reliability_percent, confirmed_competitive_game_groups, highest_display_level,
     rating_engine, rating_engine_version)
    values (v_user_id, p_initial_level, p_initial_level, 1.00, p_initial_level,
            10, 0, p_initial_level, 'app-wide-level', '1.0.0');
end;
$$;
revoke all on function public.onboard_player(text, text, numeric, text, text) from public, anon;
grant execute on function public.onboard_player(text, text, numeric, text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('player-avatars', 'player-avatars', false, 2097152,
          array['image/jpeg','image/png','image/webp']);
create policy "avatar owner select" on storage.objects for select to authenticated
  using (bucket_id = 'player-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 1);
create policy "avatar owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'player-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 1);
create policy "avatar owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'player-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 1);
