-- Session 34 — station ticket printing.
-- Align category dispatch_station to the existing prep vocabulary (kitchen|barista|bakery|none)
-- enforced by CHECK categories_dispatch_station_check.
--   'barista' = drinks printer ; 'kitchen' = hot/made-to-order ; 'bakery' = bakery/display-case
--   prep printer (UI label "Display"). cashier/waiter are DOCUMENT printers (receipt/note),
--   resolved via lan_devices.capabilities->>'station' — NOT item-routing values here.
-- Idempotent; retunable via BO later.
UPDATE categories SET dispatch_station = 'barista'
  WHERE lower(name) = 'beverage' AND dispatch_station IS DISTINCT FROM 'barista';

UPDATE categories SET dispatch_station = 'kitchen'
  WHERE lower(name) = 'sandwiches' AND dispatch_station IS DISTINCT FROM 'kitchen';

UPDATE categories SET dispatch_station = 'bakery'
  WHERE lower(name) IN ('pastry', 'bread') AND dispatch_station IS DISTINCT FROM 'bakery';
-- Viennoiserie/Bagel already 'bakery'; Plate/Savoury already 'kitchen'; Ingredient stays 'none'.
