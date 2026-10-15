create or replace function public.safe_venue_photo_uuid(p_value text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  if p_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return p_value::uuid;
exception when others then return null;
end $$;

create or replace function public.valid_community_venue_photo_key(p_key text)
returns boolean language sql immutable set search_path = '' as $$
  select p_key is not null and p_key !~ '[%\\]' and p_key !~ '(^|/)\.\.?(/|$)'
    and p_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-venue-photos', 'community-venue-photos', false, 2097152,
  array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152,
  allowed_mime_types = excluded.allowed_mime_types;

create policy community_venue_photos_select on storage.objects for select to authenticated
using (bucket_id = 'community-venue-photos' and public.valid_community_venue_photo_key(name)
  and public.safe_venue_photo_uuid(split_part(name, '/', 1)) is not null
  and public.safe_venue_photo_uuid(split_part(name, '/', 2)) is not null
  and exists (select 1 from public.community_members m
    where m.community_id = public.safe_venue_photo_uuid(split_part(name, '/', 1))
      and m.user_id = auth.uid() and m.status = 'active' and m.valid_until is null));

create policy community_venue_photos_insert on storage.objects for insert to authenticated
with check (bucket_id = 'community-venue-photos' and public.valid_community_venue_photo_key(name)
  and public.safe_venue_photo_uuid(split_part(name, '/', 3)) = auth.uid()
  and public.is_community_admin(public.safe_venue_photo_uuid(split_part(name, '/', 1)))
  and exists (select 1 from public.community_venues v
    where v.id = public.safe_venue_photo_uuid(split_part(objects.name, '/', 2))
      and v.community_id = public.safe_venue_photo_uuid(split_part(objects.name, '/', 1)) and v.archived_at is null));

create policy community_venue_photos_delete on storage.objects for delete to authenticated
using (bucket_id = 'community-venue-photos' and public.valid_community_venue_photo_key(name)
  and public.safe_venue_photo_uuid(split_part(name, '/', 3)) = auth.uid()
  and public.is_community_admin(public.safe_venue_photo_uuid(split_part(name, '/', 1)))
  and not exists (select 1 from public.community_venues v where v.photo_path = objects.name));

create function public.finalize_community_venue_photo(p_community_id uuid, p_venue_id uuid, p_object_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_venue public.community_venues%rowtype; v_object storage.objects%rowtype;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  perform 1 from public.communities c where c.id = p_community_id for update;
  if not found or not public.is_community_admin(p_community_id) then
    raise exception 'Community admin required' using errcode = 'PG001';
  end if;
  select v.* into v_venue from public.community_venues v where v.id = p_venue_id
    and v.community_id = p_community_id for update;
  if not found or v_venue.archived_at is not null then
    raise exception 'Venue unavailable' using errcode = '22023';
  end if;
  if not public.valid_community_venue_photo_key(p_object_key)
    or public.safe_venue_photo_uuid(split_part(p_object_key,'/',1)) <> p_community_id
    or public.safe_venue_photo_uuid(split_part(p_object_key,'/',2)) <> p_venue_id
    or public.safe_venue_photo_uuid(split_part(p_object_key,'/',3)) <> auth.uid() then
    raise exception 'Invalid venue photo key' using errcode = '22023';
  end if;
  select o.* into v_object from storage.objects o where o.bucket_id = 'community-venue-photos'
    and o.name = p_object_key;
  if not found or coalesce((v_object.metadata->>'size')::bigint, 2097153) > 2097152
    or coalesce(v_object.metadata->>'mimetype','') not in ('image/jpeg','image/png','image/webp') then
    raise exception 'Invalid venue photo object' using errcode = '22023';
  end if;
  update public.community_venues set photo_path = p_object_key, updated_at = now() where id = p_venue_id;
end $$;
revoke all on function public.finalize_community_venue_photo(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.finalize_community_venue_photo(uuid,uuid,text) to authenticated;
revoke all on function public.safe_venue_photo_uuid(text) from public, anon, authenticated;
revoke all on function public.valid_community_venue_photo_key(text) from public, anon, authenticated;
grant execute on function public.safe_venue_photo_uuid(text) to authenticated;
grant execute on function public.valid_community_venue_photo_key(text) to authenticated;

revoke insert (photo_path), update (photo_path) on public.community_venues from authenticated;
