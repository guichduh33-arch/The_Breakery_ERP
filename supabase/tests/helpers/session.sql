-- Données de caisse propres à la transaction de chaque test.
INSERT INTO pos_sessions (id, opened_by, opening_cash, opened_at, closed_at,
                          closed_by, status, expected_cash, closing_cash, variance_total)
VALUES ('f5430000-0000-4000-a000-000000000001',
        '00000000-0000-0000-0000-000000000001', 0,
        '2026-06-10 08:00:00+08', '2026-06-10 18:00:00+08',
        '00000000-0000-0000-0000-000000000001', 'closed', 0, 0, 0);
