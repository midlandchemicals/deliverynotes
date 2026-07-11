# Database migrations

Every schema change lives here as a numbered file. **All files are safe to
re-run** (`if not exists` everywhere), so the simple rule is:

> Open Supabase → SQL Editor → paste each file below **in order** → Run.

If a statement was already applied it does nothing. When a new feature lands,
a new numbered file appears here — run just that one.

| File | What it adds |
|---|---|
| 001_customer_defaults.sql | contact columns, label price, delivery defaults, default letterhead |
| 002_delivery_tiers_and_addresses.sql | pallet-band delivery tiers, multi-address JSON columns |
| 003_adr_columns.sql | ADR hazard classification columns on products |
| 004_price_row_extras.sql | per-product delivery charge, quantity-break tiers, tier basis |
| 005_three_tier_pricing.sql | Trade / Buyer group / Retail price columns |
| 006_per_pallet_delivery.sql | £/pallet base rate + per-product override |
| 007_seasonal_pricing.sql | seasonal price window columns |
| 008_order_no_unique.sql | **duplicate DN-number protection** (check for dupes first — see file) |
| 009_app_users_roles.sql | **admin / general roles** (edit the emails before running!) |
| 010_order_status_rename.sql | folds 'In progress' into 'New', renames generated → created |
