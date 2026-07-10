-- Seasonal pricing window (specific dates including year, YYYY-MM-DD)
alter table customer_product_prices add column if not exists season_from text;
alter table customer_product_prices add column if not exists season_to text;
alter table customer_product_prices add column if not exists season_ppl numeric;
