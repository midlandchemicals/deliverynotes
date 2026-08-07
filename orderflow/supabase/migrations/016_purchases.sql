-- Raw material & packaging purchases, for the admin Purchasing page.
--
-- One row per line of the monthly purchase spreadsheet. net_total is the LINE
-- total exactly as the sheet records it; the unit price is derived (net ÷ qty)
-- rather than stored, so it can never disagree with the figures it came from.
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_date date not null,
  supplier text not null default '',
  product text not null default '',
  qty numeric not null default 0,
  net_total numeric not null default 0,
  source text default '',          -- e.g. 'PURCHASES JULY 2026.xlsx'
  note text default '',
  created_at timestamptz default now(),
  created_by uuid
);

create index if not exists purchases_product_idx on purchases (upper(product), purchase_date desc);
create index if not exists purchases_supplier_idx on purchases (upper(supplier), purchase_date desc);
create index if not exists purchases_date_idx on purchases (purchase_date desc);

alter table purchases enable row level security;

-- Supplier buying prices are the most commercially sensitive figures in the
-- system, so unlike the rest of the schema this is admin-only. The second
-- clause mirrors the app's own fallback: if app_users has not been populated
-- yet, everyone is treated as an admin so nobody is locked out.
do $$ begin
  create policy "admins only" on purchases for all to authenticated
    using (
      exists (select 1 from app_users u
              where lower(u.email) = lower(auth.jwt() ->> 'email') and u.role = 'admin')
      or not exists (select 1 from app_users)
    )
    with check (
      exists (select 1 from app_users u
              where lower(u.email) = lower(auth.jwt() ->> 'email') and u.role = 'admin')
      or not exists (select 1 from app_users)
    );
exception when duplicate_object then null; end $$;
