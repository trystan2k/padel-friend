/** Complete trusted legacy read fixtures inside their INSERT transaction. Keep
 * deferred integrity checks enabled and use the real participation writer. */
export function matchRegistrationFixtureHistory(eventIds: string[]): string {
  if (eventIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id)))
    throw new Error('Invalid fixture event ID');
  return `declare fixture_event uuid; begin
    foreach fixture_event in array array[${eventIds.map((id) => `'${id}'::uuid`).join(',')}] loop
      insert into public.match_event_registration_state(match_event_id,next_accepted_ordinal)
        select fixture_event,coalesce(max(accepted_order),0)+1 from public.match_event_registrations where match_event_id=fixture_event
        on conflict(match_event_id) do update set next_accepted_ordinal=greatest(public.match_event_registration_state.next_accepted_ordinal,excluded.next_accepted_ordinal);
      insert into public.match_event_registration_attempts(registration_id,match_event_id,user_id,requested_at,
        decided_at,outcome,actor_id,accepted_at,approved_at,accepted_order,registration_source)
        select id,match_event_id,user_id,coalesce(requested_at,accepted_at,clock_timestamp()),
          case when lifecycle='pending' then null else coalesce(resolved_at,accepted_at,clock_timestamp()) end,
          lifecycle,case when lifecycle='accepted' then user_id else resolved_by end,
          accepted_at,approved_at,accepted_order,registration_source
        from public.match_event_registrations where match_event_id=fixture_event and current_attempt_id is null;
      update public.match_event_registrations r set current_attempt_id=a.id
        from public.match_event_registration_attempts a
        where r.match_event_id=fixture_event and r.current_attempt_id is null and a.registration_id=r.id;
      perform public.reconcile_match_registration_participation(fixture_event);
    end loop;
    set constraints all immediate;
  end;`;
}
