update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'community-venue-photos';

drop policy if exists community_venue_photos_select on storage.objects;
create policy community_venue_photos_select on storage.objects for select to authenticated
using (
  bucket_id = 'community-venue-photos'
  and public.valid_community_venue_photo_key(name)
  and public.safe_venue_photo_uuid(split_part(name, '/', 1)) is not null
  and public.is_community_member(public.safe_venue_photo_uuid(split_part(name, '/', 1)))
);

create or replace function public.valid_community_admin_defaults(p_defaults jsonb)
returns boolean language plpgsql immutable security definer set search_path = '' as $$
declare v_timezone text;
begin
  if jsonb_typeof(p_defaults) <> 'object'
    or (select count(*) from jsonb_object_keys(p_defaults)) <> 3
    or not (p_defaults ?& array['timezone','currency','member_created_leagues_enabled'])
    or jsonb_typeof(p_defaults->'timezone') <> 'string'
    or jsonb_typeof(p_defaults->'currency') <> 'string'
    or p_defaults->>'currency' <> 'EUR'
    or jsonb_typeof(p_defaults->'member_created_leagues_enabled') <> 'boolean'
    or octet_length(p_defaults::text) > 512 then return false; end if;
  v_timezone := p_defaults->>'timezone';
  if v_timezone not in ('Europe/Madrid', 'UTC') then return false; end if;
  begin
    perform pg_catalog.timezone(v_timezone, now());
  exception when others then return false;
  end;
  return true;
end $$;

create or replace function public.finalize_community_venue_photo(
  p_community_id uuid,
  p_venue_id uuid,
  p_object_key text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_venue public.community_venues%rowtype;
  v_object storage.objects%rowtype;
  v_size text;
  v_mimetype text;
  v_extension text;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  perform 1 from public.communities c where c.id = p_community_id for update;
  if not found or not public.is_community_admin(p_community_id) then
    raise exception 'Community admin required' using errcode = 'PG001';
  end if;
  select v.* into v_venue from public.community_venues v
    where v.id = p_venue_id and v.community_id = p_community_id for update;
  if not found or v_venue.archived_at is not null then
    raise exception 'Venue unavailable' using errcode = '22023';
  end if;
  if not public.valid_community_venue_photo_key(p_object_key)
    or public.safe_venue_photo_uuid(split_part(p_object_key, '/', 1)) <> p_community_id
    or public.safe_venue_photo_uuid(split_part(p_object_key, '/', 2)) <> p_venue_id
    or public.safe_venue_photo_uuid(split_part(p_object_key, '/', 3)) <> auth.uid() then
    raise exception 'Invalid venue photo key' using errcode = '22023';
  end if;
  select o.* into v_object from storage.objects o
    where o.bucket_id = 'community-venue-photos' and o.name = p_object_key;
  if not found or v_object.owner is distinct from auth.uid() then
    raise exception 'Invalid venue photo object' using errcode = '22023';
  end if;
  v_size := v_object.metadata->>'size';
  if v_size is null or v_size !~ '^[1-9][0-9]{0,6}$' or v_size::integer > 2097152 then
    raise exception 'Invalid venue photo object' using errcode = '22023';
  end if;
  v_mimetype := v_object.metadata->>'mimetype';
  v_extension := lower(split_part(split_part(p_object_key, '/', 4), '.', 2));
  if v_mimetype is null
    or v_mimetype not in ('image/jpeg', 'image/png', 'image/webp')
    or (v_mimetype = 'image/jpeg' and v_extension not in ('jpg', 'jpeg'))
    or (v_mimetype = 'image/png' and v_extension <> 'png')
    or (v_mimetype = 'image/webp' and v_extension <> 'webp') then
    raise exception 'Invalid venue photo object' using errcode = '22023';
  end if;
  update public.community_venues set photo_path = p_object_key, updated_at = now()
    where id = p_venue_id;
end $$;
