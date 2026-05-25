-- Session 31 / Wave 1.C — pgTAP : verify orders.read permission seeded + granted MANAGER+
BEGIN;
SELECT plan(2);

SELECT ok(
  EXISTS(SELECT 1 FROM permissions WHERE code = 'orders.read'),
  'T1: permission orders.read is seeded'
);

SELECT is(
  (SELECT COUNT(*)::int FROM role_permissions
   WHERE permission_code = 'orders.read'
     AND role_code IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN')),
  3,
  'T2: orders.read granted to MANAGER + ADMIN + SUPER_ADMIN (3 rows)'
);

SELECT * FROM finish();
ROLLBACK;
