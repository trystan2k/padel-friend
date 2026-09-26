create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index notes_user_id_created_at_idx on public.notes (user_id, created_at desc);
alter table public.notes enable row level security;

create policy "owners can read notes" on public.notes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "owners can insert notes" on public.notes for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "owners can delete notes" on public.notes for delete to authenticated
  using ((select auth.uid()) = user_id);
