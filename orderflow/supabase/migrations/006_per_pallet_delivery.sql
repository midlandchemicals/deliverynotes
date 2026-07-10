-- Per-pallet delivery: customer base rate + per-product override
alter table customers add column if not exists delivery_per_pallet numeric default 0;
alter table customer_product_prices add column if not exists delivery_per_pallet numeric not null default 0;
