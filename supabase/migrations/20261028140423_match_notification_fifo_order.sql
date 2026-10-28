begin;

alter table public.notifications
  add column sequence bigint;

-- Preserve the historical feed order before identity values control new rows.
-- Rows sharing created_at (typically written in one transaction) have no
-- recoverable producer order; id is only a deterministic tie-break. New rows
-- receive true producer order from the identity sequence after this backfill.
-- backfill: legacy chronological order (test anchor)
with historical_order as (
  select id, row_number() over (order by created_at, id) as sequence
  from public.notifications
)
update public.notifications as notification
set sequence = historical_order.sequence
from historical_order
where notification.id = historical_order.id;

alter table public.notifications
  alter column sequence set not null;

do $migration$
declare
  next_sequence bigint;
begin
  select coalesce(max(sequence), 0) + 1
  into next_sequence
  from public.notifications;

  execute format(
    'alter table public.notifications alter column sequence add generated always as identity (start with %s)',
    next_sequence
  );
end
$migration$;

-- Notification pages filter by recipient and order by the identity sequence.
grant select (sequence) on public.notifications to authenticated;

create index notifications_recipient_sequence_idx
  on public.notifications (recipient_user_id, sequence desc, created_at desc, id desc);

create index notifications_recipient_category_sequence_idx
  on public.notifications (recipient_user_id, category, sequence desc, created_at desc, id desc);

commit;
