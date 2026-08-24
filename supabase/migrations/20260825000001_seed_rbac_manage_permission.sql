-- 20260825000001_seed_rbac_manage_permission.sql
-- ADR-031 — RBAC éditable SUPER_ADMIN. Permission de mutation neuve `rbac.manage`
-- (le code supprimé `rbac.update` n'est pas ressuscité — décision 2026-07-06 supersédée).
-- Seed SUPER_ADMIN uniquement : le verrou réel est le test de rôle dans les RPC ADR-031 ;
-- ce code sert surtout au filtrage de navigation côté back-office.
-- L'INSERT role_permissions déclenche trg_audit_role_permissions avec actor_id NULL
-- (écriture de migration — comportement documenté du trigger).

INSERT INTO permissions (code, module, action, description)
VALUES ('rbac.manage', 'rbac', 'manage',
        'Mutate RBAC config (role grants, user overrides). SUPER_ADMIN only.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code)
VALUES ('SUPER_ADMIN', 'rbac.manage')
ON CONFLICT (role_code, permission_code) DO NOTHING;
