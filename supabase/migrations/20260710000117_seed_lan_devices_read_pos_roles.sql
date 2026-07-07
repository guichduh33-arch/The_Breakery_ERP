-- 20260710000117_seed_lan_devices_read_pos_roles.sql
-- S66 — dette D-9 (INDEX S65) : le SELECT de lan_devices est gaté
-- has_permission('lan.devices.read') (policy lan_devices_select_authenticated,
-- constat DEV-S65-02), mais la permission n'était seedée qu'à
-- SUPER_ADMIN/ADMIN/MANAGER. Or le POS lit lan_devices en direct via
-- useStationPrinters (apps/pos/src/features/cart/hooks/useStationPrinters.ts)
-- pour router les KOT vers les imprimantes de station : pour un CASHIER ou un
-- waiter, RLS renvoyait 0 ligne EN SILENCE -> map d'imprimantes vide -> aucun
-- ticket cuisine imprimé, sans erreur.
--
-- Fix : seed lan.devices.read aux 2 rôles POS. Lecture seule et non sensible
-- (nom/IP/port d'imprimantes du LAN boutique) ; lan.devices.manage reste
-- ADMIN/SUPER_ADMIN. Le test lan_devices_rls.test.sql T3 est mis à jour dans
-- la même session (CASHIER voit désormais la fixture printer).

INSERT INTO role_permissions (role_code, permission_code, is_granted)
VALUES
  ('CASHIER', 'lan.devices.read', TRUE),
  ('waiter',  'lan.devices.read', TRUE)
ON CONFLICT (role_code, permission_code) DO UPDATE SET is_granted = TRUE;
