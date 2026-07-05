-- S62: RBAC lecture seule assumée (décision propriétaire 2026-07-06) — l'éditeur est ANNULÉ.
-- FK role_permissions/user_permission_overrides ON DELETE CASCADE (20260517000030).
DELETE FROM public.permissions WHERE code = 'rbac.update';
