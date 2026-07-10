-- Pallet-band delivery tiers + multi-address JSON columns
create table if not exists customer_delivery_tiers (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  pallets_from int not null default 1,
  pallets_to int,
  charge numeric not null default 0,
  created_at timestamptz default now()
);
alter table customer_delivery_tiers enable row level security;
do $$ begin
  create policy "auth all" on customer_delivery_tiers for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
alter table customers add column if not exists invoice_addresses jsonb default '[]';
alter table customers add column if not exists delivery_addresses jsonb default '[]';
