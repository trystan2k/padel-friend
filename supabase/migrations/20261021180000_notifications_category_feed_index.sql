begin;

-- Scope category feeds before scanning their descending cursor order.
create index notifications_recipient_category_created_idx
  on public.notifications (recipient_user_id, category, created_at desc, id desc);

-- Whole-store unread counts already use notifications_recipient_unread_idx.

commit;
