-- Staff-to-staff instant messages, shown in the floating chat panel.
--
-- Keyed by email rather than auth user id because app_users is an email list —
-- that keeps the directory, the policies and the app all using the same key.
-- Unlike the rest of the app, these rows are NOT readable by everyone signed
-- in: a conversation is visible only to the two people in it.
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  sender_email text not null,
  recipient_email text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists messages_pair_idx on messages (sender_email, recipient_email, created_at desc);
create index if not exists messages_unread_idx on messages (recipient_email, read_at);

alter table messages enable row level security;

-- Read: only the sender or the recipient.
do $$ begin
  create policy "read own messages" on messages for select to authenticated
    using (lower(auth.jwt() ->> 'email') in (lower(sender_email), lower(recipient_email)));
exception when duplicate_object then null; end $$;

-- Send: only as yourself, so nobody can post as someone else.
do $$ begin
  create policy "send as self" on messages for insert to authenticated
    with check (lower(auth.jwt() ->> 'email') = lower(sender_email));
exception when duplicate_object then null; end $$;

-- Update: only the recipient, and only to stamp read_at.
do $$ begin
  create policy "recipient marks read" on messages for update to authenticated
    using (lower(auth.jwt() ->> 'email') = lower(recipient_email))
    with check (lower(auth.jwt() ->> 'email') = lower(recipient_email));
exception when duplicate_object then null; end $$;

-- Live delivery — without this the panel only updates on refresh.
do $$ begin
  alter publication supabase_realtime add table messages;
exception when duplicate_object then null; end $$;
