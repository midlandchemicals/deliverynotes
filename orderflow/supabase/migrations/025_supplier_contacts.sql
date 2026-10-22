-- Contact details for the suppliers we buy from.
--
-- Supplier names on the purchase sheets are typed by hand, so contacts are
-- keyed on the same normalised name the Purchasing page pools spellings under
-- ("BRENNTAG UK LTD" and "Brenntag UK Ltd." share one contact card).
create table if not exists supplier_contacts (
  key text primary key,            -- normalised supplier name
  name text not null default '',   -- the name as shown when it was saved
  contact_name text default '',
  email text default '',
  phone text default '',
  notes text default '',
  updated_at timestamptz default now()
);

alter table supplier_contacts enable row level security;

-- Same access as the purchases themselves: admins, plus anyone with the
-- 'purchasing' role (Rob). Empty app_users table = everyone, as elsewhere.
do $$ begin
  create policy "purchasing access" on supplier_contacts for all to authenticated
    using (
      exists (select 1 from app_users u
              where lower(u.email) = lower(auth.jwt() ->> 'email') and u.role in ('admin', 'purchasing'))
      or not exists (select 1 from app_users)
    )
    with check (
      exists (select 1 from app_users u
              where lower(u.email) = lower(auth.jwt() ->> 'email') and u.role in ('admin', 'purchasing'))
      or not exists (select 1 from app_users)
    );
exception when duplicate_object then null; end $$;
