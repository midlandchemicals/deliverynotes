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
  contact_name text default '',
  email text default '',
  phone text default '',
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

-- ---------- row level security ----------
-- Internal team app: any signed-in user may read/write everything.
alter table customers      enable row level security;
alter table products       enable row level security;
alter table packaging      enable row level security;
alter table letterheads    enable row level security;
alter table orders         enable row level security;
alter table dispatch_notes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['customers','products','packaging','letterheads','orders','dispatch_notes']
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
--
-- ADR hazard classification columns for products (run once on existing databases):
--   alter table products add column if not exists adr_class text default '';
--   alter table products add column if not exists adr_subsidiary text default '';
--   alter table products add column if not exists adr_tunnel text default '';
--   alter table products add column if not exists adr_psn text default '';
--   alter table products add column if not exists adr_verified_by text default '';
--   alter table products add column if not exists adr_verified_at timestamptz;
