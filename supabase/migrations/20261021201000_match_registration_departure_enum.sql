-- Enum values must commit before the departures migration uses them.
alter type public.match_registration_lifecycle add value 'withdrawn';
alter type public.match_registration_lifecycle add value 'removed_by_creator';
