create or replace function public.safe_match_photo_uuid(p_value text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  if p_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  return p_value::uuid;
exception when others then return null;
end $$;

create or replace function public.valid_match_photo_key(p_key text)
returns boolean language sql immutable set search_path = '' as $$
  select p_key is not null and p_key !~ '[%\\]' and p_key !~ '(^|/)\.\.?(/|$)'
    and p_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('match-event-photos', 'match-event-photos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = excluded.allowed_mime_types;

create policy match_event_photos_insert on storage.objects for insert to authenticated
with check (bucket_id = 'match-event-photos' and coalesce((select auth.jwt()->>'is_anonymous'),'false') <> 'true'
  and public.valid_match_photo_key(name)
  and owner_id = (select auth.uid())::text
  and public.safe_match_photo_uuid(split_part(name,'/',3)) = (select auth.uid())
  and exists (select 1 from public.match_events e where e.id = public.safe_match_photo_uuid(split_part(name,'/',2))) = false
  and public.is_community_member(public.safe_match_photo_uuid(split_part(name,'/',1))));

create policy match_event_photos_select on storage.objects for select to authenticated
using (bucket_id = 'match-event-photos' and coalesce((select auth.jwt()->>'is_anonymous'),'false') <> 'true'
  and public.valid_match_photo_key(name)
  and ((owner_id = (select auth.uid())::text and public.safe_match_photo_uuid(split_part(name,'/',3)) = (select auth.uid())
    and public.is_community_member(public.safe_match_photo_uuid(split_part(name,'/',1)))
    and not exists(select 1 from public.match_events e where e.photo_path = objects.name))
    or exists(select 1 from public.match_events e where e.photo_path = objects.name and public.can_read_match_event(e.id))));

create policy match_event_photos_delete on storage.objects for delete to authenticated
using (bucket_id = 'match-event-photos' and coalesce((select auth.jwt()->>'is_anonymous'),'false') <> 'true'
  and public.valid_match_photo_key(name)
  and owner_id = (select auth.uid())::text
  and public.safe_match_photo_uuid(split_part(name,'/',3)) = (select auth.uid())
  and public.is_community_member(public.safe_match_photo_uuid(split_part(name,'/',1)))
  and not exists(select 1 from public.match_events e where e.photo_path = objects.name));

create function public.guard_match_photo_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.bucket_id = 'match-event-photos' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(old.name, 72072));
    if exists(select 1 from public.match_events e where e.photo_path = old.name) then
      raise exception 'Attached match photo cannot be deleted' using errcode = '23514';
    end if;
  end if;
  return old;
end $$;
create trigger guard_match_photo_delete before delete on storage.objects
for each row execute function public.guard_match_photo_delete();

-- Publication and storage deletion serialize on the exact object key.
create function public.lock_match_photo_publication() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.valid_match_photo_key(new.photo_path)
    or public.safe_match_photo_uuid(split_part(new.photo_path,'/',1)) <> new.community_id
    or public.safe_match_photo_uuid(split_part(new.photo_path,'/',2)) <> new.id
    or public.safe_match_photo_uuid(split_part(new.photo_path,'/',3)) <> new.created_by then
    raise exception 'Invalid match photo attachment' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.photo_path, 72072));
  if not exists (select 1 from storage.objects o where o.bucket_id='match-event-photos' and o.name=new.photo_path
    and o.owner_id=new.created_by::text and coalesce((o.metadata->>'size')::bigint,2097153) between 1 and 2097152
    and coalesce(o.metadata->>'mimetype','') in ('image/jpeg','image/png','image/webp')) then
    raise exception 'Match photo object unavailable' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger lock_match_photo_publication before insert on public.match_events
for each row execute function public.lock_match_photo_publication();

revoke all on function public.safe_match_photo_uuid(text), public.valid_match_photo_key(text), public.guard_match_photo_delete(), public.lock_match_photo_publication() from public, anon, authenticated;
grant execute on function public.safe_match_photo_uuid(text), public.valid_match_photo_key(text) to authenticated;
