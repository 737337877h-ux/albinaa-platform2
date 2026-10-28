ALTER TABLE oracle_item_units_mirror
  ADD COLUMN IF NOT EXISTS sale_price NUMERIC(38,16);
