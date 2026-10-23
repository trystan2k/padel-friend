do $$
declare e public.match_events%rowtype;
begin
  select * into strict e from public.match_events where id='73000000-0000-4000-8000-000000000099';
  if e.published_by<>e.created_by or e.version<>1 or e.status<>'open' or e.updated_at<>e.created_at
    or e.cancelled_at is not null or e.cancelled_by is not null or e.cancel_reason is not null
    or split_part(e.photo_path,'/',3)<>e.published_by::text then raise exception 'Ownership backfill mismatch'; end if;
  if (select count(*) from public.match_event_registrations where match_event_id=e.id and accepted_order=1 and cancelled_at is null)<>1
    or (select count(*) from public.match_event_registration_attempts where match_event_id=e.id and ended_at is null)<>1
    or exists(select 1 from public.notifications where target_id=e.id)
    or exists(select 1 from public.match_event_audit_log where match_event_id=e.id)
    or exists(select 1 from public.match_event_management_commands where match_event_id=e.id) then raise exception 'Historical upgrade produced effects or lost history'; end if;
end $$;
