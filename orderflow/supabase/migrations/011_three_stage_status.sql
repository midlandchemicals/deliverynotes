-- Three-stage order flow: New Order → On Board → Delivery Note Printed.
update orders set status = 'New Order' where status in ('New', 'In progress');
update orders set status = 'Delivery Note Printed'
  where status in ('Delivery Note Generated', 'Delivery Note Created');
