-- Short public links for proformas (/p/<token>). The token maps to the stored
-- PDF path; the /p route resolves it with the service role. No public read
-- policy — the table must NOT be dumpable via the API, only the server route
-- (service role, which bypasses RLS) reads it.
create table if not exists proforma_links (
  token text primary key,
  order_id uuid references orders(id) on delete cascade,
  doc_no text,
  path text not null,
  created_at timestamptz default now(),
  expires_at timestamptz
);
alter table proforma_links enable row level security;
-- Logged-in staff can create links from the app (anon key + auth session).
do $$ begin
  create policy "proforma_links auth insert" on proforma_links
    for insert to authenticated with check (true);
exception when duplicate_object then null; end $$;
