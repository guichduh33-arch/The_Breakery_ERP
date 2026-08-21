-- 20260821000001_permissions_descriptions_en.sql
--
-- L'interface parle ANGLAIS (CLAUDE.md, apps/backoffice/PRODUCT.md). La matrice
-- des permissions (Settings > Permissions) rend `permissions.description` telle
-- quelle : 15 des 151 lignes étaient encore en français, dont
-- `customers.pos.create` qui fuyait une référence interne (« ADR-020 déc. 2 »)
-- jusque sous les yeux d'un opérateur de boutique. La référence appartient au
-- dépôt, pas à l'écran : elle est retirée volontairement, pas oubliée.
--
-- Migration de DONNÉES uniquement — aucun changement de schéma, donc aucune
-- régénération de `packages/supabase/src/types.generated.ts` n'est requise.

UPDATE permissions SET description = 'Create a retail customer from the POS (express creation, retail type only)' WHERE code = 'customers.pos.create';
UPDATE permissions SET description = 'Plan production batch slots (7-day x 4-slot grid)'                        WHERE code = 'inventory.production.schedule';
UPDATE permissions SET description = 'Take payment for a sale'                                                  WHERE code = 'pos.sale.create';
UPDATE permissions SET description = 'Edit a sale'                                                              WHERE code = 'pos.sale.update';
UPDATE permissions SET description = 'Void a sale'                                                              WHERE code = 'pos.sale.void';
UPDATE permissions SET description = 'Close another user''s register session'                                   WHERE code = 'pos.session.close_other';
UPDATE permissions SET description = 'Close your own register session'                                          WHERE code = 'pos.session.close_own';
UPDATE permissions SET description = 'Open a register session'                                                  WHERE code = 'pos.session.open';
UPDATE permissions SET description = 'View all register sessions'                                               WHERE code = 'pos.session.view_all';
UPDATE permissions SET description = 'Create a product'                                                         WHERE code = 'products.create';
UPDATE permissions SET description = 'Read the product catalog'                                                 WHERE code = 'products.read';
UPDATE permissions SET description = 'Edit a product'                                                           WHERE code = 'products.update';
UPDATE permissions SET description = 'Create a user'                                                            WHERE code = 'users.create';
UPDATE permissions SET description = 'Edit a user'                                                              WHERE code = 'users.update';
UPDATE permissions SET description = 'Read the audit log'                                                       WHERE code = 'users.view_audit';

-- `roles.description` n'est rendu NULLE PART dans l'interface aujourd'hui (la
-- matrice ne s'en sert que pour l'attribut `title` d'un en-tête de colonne).
-- C'est donc de l'hygiène de données, pas un correctif visible : on l'aligne
-- pour que la colonne cesse de mélanger deux langues.
UPDATE roles SET description = 'Business administration'                  WHERE code = 'ADMIN';
UPDATE roles SET description = 'Cashier — POS sales and shift opening'    WHERE code = 'CASHIER';
UPDATE roles SET description = 'Operational management (POS and products)' WHERE code = 'MANAGER';
UPDATE roles SET description = 'Full system access'                       WHERE code = 'SUPER_ADMIN';
