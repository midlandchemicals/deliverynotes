-- ============================================================
-- OrderFlow schema — run this once in Supabase
-- (Supabase dashboard -> SQL Editor -> paste -> Run)
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- catalog tables ----------
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  details text default '',
  deliver text default '',
  invoice_addresses jsonb default '[]',   -- [{label, text}] — multiple invoice addresses
  delivery_addresses jsonb default '[]',  -- [{label, text, contact:{name,email,phone}}] — multiple delivery addresses
  contact_name text default '',
  email text default '',
  phone text default '',
  label_price numeric default 0,
  default_delivery_charge numeric default 0,
  free_delivery_above numeric default 0,
  -- When true, each product carries three buyer prices (Trade / Buyer group /
  -- Retail) and the order picks which level applies.
  three_tier_pricing boolean not null default false,
  created_at timestamptz default now()
);

-- ---------- per-customer pallet delivery tiers ----------
create table if not exists customer_delivery_tiers (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  pallets_from int not null default 1,
  pallets_to int,                         -- null = "and above" (open-ended top tier)
  charge numeric not null default 0,
  created_at timestamptz default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sg numeric not null default 1.0,
  pg text default '',
  un_number text default '',
  category text default '',
  adr_class text default '',
  adr_subsidiary text default '',
  adr_tunnel text default '',
  adr_psn text default '',
  adr_transport_cat text default '',
  adr_verified_by text default '',
  adr_verified_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists packaging (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  volume numeric not null default 0,
  tare numeric not null default 0,
  created_at timestamptz default now()
);

create table if not exists letterheads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text default '',
  address text default '',
  footer text default '',
  color text default '#0a6b61',
  logo text,
  created_at timestamptz default now()
);

-- ---------- orders ----------
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null,
  customer_id uuid references customers(id) on delete set null,
  customer_snapshot jsonb,        -- {name, details, deliver} captured at order time
  po_ref text default '',
  order_date date default now(),
  requested_date date,
  status text not null default 'New',   -- New | In progress | Delivery Note Generated
  notes text default '',
  lines jsonb not null default '[]',     -- [{productId, packagingId, qty}]
  price_level text,                      -- 'trade'|'buyer_group'|'retail' for 3-tier customers
  added_by text default '',              -- email of user who created the order
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists orders_status_idx on orders(status);
create index if not exists orders_created_idx on orders(created_at desc);

-- ---------- generated delivery notes ----------
create table if not exists dispatch_notes (
  id uuid primary key default gen_random_uuid(),
  doc_no text not null,
  doc_type text default 'Delivery Note',
  doc_date date default now(),
  order_id uuid references orders(id) on delete set null,
  letterhead_snapshot jsonb,
  customer text default '',
  deliver text default '',
  lines_snapshot jsonb,           -- resolved lines with computed net/gross
  totals jsonb,
  options text default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists dispatch_order_idx on dispatch_notes(order_id);

-- ---------- per-customer pricing ----------
create table if not exists customer_product_prices (
  id uuid primary key default gen_random_uuid(),
  customer_id  uuid references customers(id)  on delete cascade,
  product_id   uuid references products(id)   on delete cascade,
  packaging_id uuid references packaging(id)  on delete cascade,
  price_per_litre numeric not null default 0,
  delivery_charge numeric not null default 0,
  -- Optional quantity break tiers: price per litre changes with packs ordered.
  -- [{ "from": 1, "to": 2, "ppl": 1.34 }, { "from": 5, "to": null, "ppl": 1.18 }]
  -- `to` null means "and above". Base price_per_litre is the fallback.
  qty_tiers jsonb not null default '[]',
  -- Which quantity decides the tier band:
  --   'line'  → this product line's own pack qty (default)
  --   'order' → combined pack qty of ALL 'order'-basis products on the order
  tier_basis text not null default 'line',
  -- Three buyer-level prices (per litre) for three_tier_pricing customers.
  -- Null falls back to price_per_litre. price_per_litre mirrors price_trade.
  price_trade numeric,
  price_buyer_group numeric,
  price_retail numeric,
  -- Seasonal price: when the order is placed within the date window
  -- (season_from..season_to, specific dates incl. year), season_ppl overrides
  -- the normal/tier/level price. Null = no seasonal pricing.
  season_from text,   -- 'YYYY-MM-DD'
  season_to text,     -- 'YYYY-MM-DD'
  season_ppl numeric,
  updated_at timestamptz default now(),
  unique(customer_id, product_id, packaging_id)
);

-- ---------- app settings (key/value store) ----------
create table if not exists app_settings (
  key   text primary key,
  value text default ''
);
-- Seed with empty pricing password (no protection until one is set)
insert into app_settings (key, value) values ('pricing_password', '') on conflict do nothing;

-- ---------- row level security ----------
-- Internal team app: any signed-in user may read/write everything.
alter table customers                    enable row level security;
alter table customer_delivery_tiers      enable row level security;
alter table products                enable row level security;
alter table packaging               enable row level security;
alter table letterheads             enable row level security;
alter table orders                  enable row level security;
alter table customer_product_prices enable row level security;
alter table dispatch_notes enable row level security;
alter table app_settings enable row level security;

do $$
declare t text;
begin
  foreach t in array array['customers','products','packaging','letterheads','orders','dispatch_notes','customer_product_prices','app_settings','customer_delivery_tiers']
  loop
    execute format('drop policy if exists "auth all" on %I;', t);
    execute format('create policy "auth all" on %I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;

-- ---------- seed data (optional starter rows) ----------
insert into letterheads (name, company, address, footer, color) values
 ('Letterhead A','Your Company Ltd',
  E'Industrial Estate, Unit 1\nManchester, M1 2AB\nUnited Kingdom\nTel: +44 161 000 0000  ·  ops@yourco.com',
  'Your Company Ltd · Reg. No. 00000000 · VAT GB000000000','#0a6b61'),
 ('Letterhead B','Partner Distribution Co.',
  E'45 Commerce Way\nLondon, EC1A 1BB\nUnited Kingdom',
  'Partner Distribution Co. · Reg. No. 11111111 · E&OE.','#0d5c8a'),
 ('Letterhead C','Third Brand', E'Trade Park, Leeds\nLS1 1AA', 'Third Brand.','#1d3f72'),
 ('Letterhead D','Fourth Brand', E'Dock Road, Hull\nHU1 1AA', 'Fourth Brand.','#7a2f2f');

insert into products (name, sg, pg, un_number) values
 ('Sodium Hypochlorite 14%', 1.20, 'PG II', 'UN1791'),
 ('Hydrochloric Acid 31%',   1.16, 'PG II', 'UN1789'),
 ('Sulphuric Acid 98%',      1.84, 'PG II', 'UN1830'),
 ('Sodium Hydroxide 50%',    1.52, 'PG II', 'UN1824'),
 ('Citric Acid Solution 50%',1.24, '—',     '');

insert into packaging (name, volume, tare) values
 ('25 L Container', 25, 1.2),
 ('200 L Drum',     200, 9),
 ('1000 L IBC',     1000, 55),
 ('5 L Bottle',     5, 0.3);

insert into customers (name, details, deliver, contact_name, email, phone) values
 ('Acme Industrial Ltd',
  E'Acme Industrial Ltd\nAttn: Purchasing Dept\nVAT: GB123456789',
  E'Unit 4, Dock Road\nLiverpool\nL20 8XX\nUnited Kingdom',
  'Jane Smith', 'orders@acme.co.uk', '0151 000 0000');

-- ---------- migration for existing databases ----------
-- If your customers table already exists, run these once:
--   alter table customers add column if not exists contact_name text default '';
--   alter table customers add column if not exists email text default '';
--   alter table customers add column if not exists phone text default '';
--   alter table customers add column if not exists label_price numeric default 0;
--   alter table customers add column if not exists default_delivery_charge numeric default 0;
--   alter table customers add column if not exists free_delivery_above numeric default 0;
--   alter table customers add column if not exists default_letterhead_id uuid references letterheads(id) on delete set null;
--
-- Pallet delivery tiers (run once on existing databases):
--   create table if not exists customer_delivery_tiers (
--     id uuid primary key default gen_random_uuid(),
--     customer_id uuid references customers(id) on delete cascade,
--     pallets_from int not null default 1,
--     pallets_to int,
--     charge numeric not null default 0,
--     created_at timestamptz default now()
--   );
--   alter table customer_delivery_tiers enable row level security;
--   create policy "auth all" on customer_delivery_tiers for all to authenticated using (true) with check (true);
--   alter table customers add column if not exists invoice_addresses jsonb default '[]';
--   alter table customers add column if not exists delivery_addresses jsonb default '[]';
--
-- ADR hazard classification columns for products (run once on existing databases):
--   alter table products add column if not exists adr_class text default '';
--   alter table products add column if not exists adr_subsidiary text default '';
--   alter table products add column if not exists adr_tunnel text default '';
--   alter table products add column if not exists adr_psn text default '';
--   alter table products add column if not exists adr_transport_cat text default '';
--   alter table products add column if not exists adr_verified_by text default '';
--   alter table products add column if not exists adr_verified_at timestamptz;
--
-- Delivery charge column on customer_product_prices (run once on existing databases):
--   alter table customer_product_prices add column if not exists delivery_charge numeric default 0;
--
-- Quantity-break price tiers on customer_product_prices (run once on existing databases):
--   alter table customer_product_prices add column if not exists qty_tiers jsonb not null default '[]';
--   alter table customer_product_prices add column if not exists tier_basis text not null default 'line';
--
-- Three buyer-level pricing (run once on existing databases):
--   alter table customers add column if not exists three_tier_pricing boolean not null default false;
--   alter table customer_product_prices add column if not exists price_trade numeric;
--   alter table customer_product_prices add column if not exists price_buyer_group numeric;
--   alter table customer_product_prices add column if not exists price_retail numeric;
--   alter table orders add column if not exists price_level text;
--
-- Seasonal pricing (run once on existing databases):
--   alter table customer_product_prices add column if not exists season_from text;
--   alter table customer_product_prices add column if not exists season_to text;
--   alter table customer_product_prices add column if not exists season_ppl numeric;
--
-- Per-customer pricing table (run once on existing databases):
--   drop table if exists customer_product_prices;
--   create table customer_product_prices (
--     id uuid primary key default gen_random_uuid(),
--     customer_id  uuid references customers(id)  on delete cascade,
--     product_id   uuid references products(id)   on delete cascade,
--     packaging_id uuid references packaging(id)  on delete cascade,
--     price_per_litre numeric not null default 0,
--     updated_at timestamptz default now(),
--     unique(customer_id, product_id, packaging_id)
--   );
--   alter table customer_product_prices enable row level security;
--   create policy "auth all" on customer_product_prices for all to authenticated using (true) with check (true);
