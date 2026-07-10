-- Admin / general roles. Pricing is visible ONLY to role = 'admin'.
--
-- !!! EDIT THE EMAILS BELOW BEFORE RUNNING !!!
-- Every login must be listed: anyone signed in but NOT in this table is
-- treated as 'general' (no pricing). If the table is empty, everyone is
-- treated as admin (so nothing breaks before you run this).
create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  role text not null default 'general',  -- 'admin' or 'general'
  created_at timestamptz default now()
);
alter table app_users enable row level security;
-- Signed-in users can READ roles (the app needs to know who's admin).
-- No write policy: rows can only be changed from the Supabase dashboard
-- (Table Editor), which avoids recursive-policy problems.
do $$ begin
  create policy "auth read" on app_users for select to authenticated using (true);
exception when duplicate_object then null; end $$;

insert into app_users (email, role) values
  ('RAHUL-EMAIL-HERE',  'admin'),
  ('SUNNY-EMAIL-HERE',  'admin'),
  ('LOUISE-EMAIL-HERE', 'admin'),
  ('ROB-EMAIL-HERE',    'general'),
  ('OFFICE-EMAIL-HERE', 'general')
on conflict (email) do nothing;
