-- Sales-leads tracker for cold outreach to prospective customers.
--
-- Private to Rahul only — this is his personal prospecting pipeline, not
-- something the wider office (or even the other admins, Sunny & Louise) should
-- see. The page is gated to his email in the app; the RLS below enforces the
-- same thing at the database, so the rows are unreadable to anyone else even
-- with a direct query.
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  company text not null default '',
  industry text not null default 'construction',  -- construction | automotive | speciality
  contact_name text default '',
  contact_role text default '',
  email text default '',
  phone text default '',
  website text default '',
  linkedin text default '',
  -- Outreach stages — each is a simple done / not-done flag with the date it
  -- happened, so the pipeline can be read at a glance and sorted by activity.
  email_sent boolean not null default false,
  email_sent_at date,
  acknowledged boolean not null default false,       -- they replied / acknowledged
  acknowledged_at date,
  linkedin_followed boolean not null default false,
  linkedin_followed_at date,
  linkedin_messaged boolean not null default false,
  linkedin_messaged_at date,
  -- Where the conversation stands. Free stage label so it can grow with use.
  status text not null default 'new',   -- new | contacted | in_conversation | won | lost
  notes text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid
);

create index if not exists leads_industry_idx on leads (industry);
create index if not exists leads_status_idx on leads (status);
create index if not exists leads_created_idx on leads (created_at desc);

alter table leads enable row level security;

-- Rahul only. His email is hard-wired here rather than driven off a role,
-- because "admin" also covers Sunny and Louise and this must stay his alone.
-- Change the address below if his login ever changes.
do $$ begin
  create policy "rahul only" on leads for all to authenticated
    using (lower(auth.jwt() ->> 'email') = 'rahulpathakappleid@gmail.com')
    with check (lower(auth.jwt() ->> 'email') = 'rahulpathakappleid@gmail.com');
exception when duplicate_object then null; end $$;
