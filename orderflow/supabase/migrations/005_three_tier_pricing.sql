-- Three buyer-level pricing (Trade / Buyer group / Retail)
alter table customers add column if not exists three_tier_pricing boolean not null default false;
alter table customer_product_prices add column if not exists price_trade numeric;
alter table customer_product_prices add column if not exists price_buyer_group numeric;
alter table customer_product_prices add column if not exists price_retail numeric;
alter table orders add column if not exists price_level text;
