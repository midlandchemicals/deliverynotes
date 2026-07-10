-- Per-product delivery charge + quantity-break tiers on customer prices
alter table customer_product_prices add column if not exists delivery_charge numeric default 0;
alter table customer_product_prices add column if not exists qty_tiers jsonb not null default '[]';
alter table customer_product_prices add column if not exists tier_basis text not null default 'line';
