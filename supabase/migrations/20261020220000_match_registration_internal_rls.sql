begin;

alter table public.match_event_registration_state enable row level security;
alter table public.match_event_registration_attempts enable row level security;

commit;
