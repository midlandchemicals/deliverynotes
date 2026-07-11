-- Simplify order statuses to just two: 'New' and 'Delivery Note Created'.
-- 'In progress' had no function and is folded into 'New';
-- 'Delivery Note Generated' is renamed to 'Delivery Note Created'.
update orders set status = 'New' where status = 'In progress';
update orders set status = 'Delivery Note Created' where status = 'Delivery Note Generated';
