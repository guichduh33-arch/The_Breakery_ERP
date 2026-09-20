# pos-flow-audit — contrôles et sources

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Sources of truth (verified pointers)
- Verification before claiming an audit or proposal is done
- When to escalate / flag

## Sources of truth (verified pointers)

```
Intention métier (read first — ce qui est VOULU ; le code dit ce qui EST)
  docs/objectifs/POS.md
  docs/objectifs/ORDERS.md
  docs/objectifs/CASH_REGISTER.md
  docs/objectifs/KDS.md
  docs/objectifs/CUSTOMER_DISPLAY.md
  docs/objectifs/TABLET_ORDERING.md
  docs/objectifs/PROMOTIONS_AND_COMBOS.md

Décisions (immuables, font loi — une proposition qui les contredit se signale, elle ne s'implémente pas)
  docs/adr/

POS features (thin UI wiring — the journey)
  apps/pos/src/features/{cart,payment,kds,tablet,inbox,display,promotions,discounts,shift,heldOrders,tables,floor-plan,order-history,lan,loyalty,combos}/

Domain (pure TS — business logic, IO-free, unit-testable)
  packages/domain/src/orders/buildOrderPayload.ts       # final payload for process-payment EF
  packages/domain/src/cart/{mutations.ts,calculateTotals.ts}
  packages/domain/src/payment/{validatePayment.ts,calculateChange.ts,splitTender.ts}
  packages/domain/src/promotions/{evaluator.ts,bogoEngine.ts}
  packages/domain/src/{kitchen,tables,loyalty}/

Write paths
  supabase/functions/process-payment/index.ts           # → famille complete_order_with_payment
  supabase/migrations/*order*.sql / *payment*.sql / *shift*.sql / *tablet*.sql
  # le glob *order* attrape aussi fire_counter_order, hold_fired_order,
  # reopen_held_order, discard_held_order — prendre le numéro le PLUS HAUT.

Preuves pgTAP existantes (à lire avant de déclarer un gap ouvert sur ces chemins)
  supabase/tests/adr022_paid_order_reaches_kds.test.sql   # l'envoi comptoir atteint bien le KDS
  supabase/tests/counter_fire.test.sql
  supabase/tests/*held*.test.sql + supabase/tests/*hold*.test.sql   # parking serveur

Patterns canon
  CLAUDE.md "Critical patterns" (the live truth)
```

## Verification before claiming an audit or proposal is done

```bash
# Cheap, first
pnpm typecheck
pnpm --filter @breakery/domain test orders
pnpm --filter @breakery/domain test payment
pnpm --filter @breakery/domain test promotions

# POS smoke (per feature touched)
pnpm --filter @breakery/app-pos test payment
pnpm --filter @breakery/app-pos test tablet
pnpm --filter @breakery/app-pos test kds

# RPC-level: pgTAP via Supabase MCP execute_sql with BEGIN/ROLLBACK envelope.
# DB target is V3 dev cloud `ikcyvlovptebroadgtvd` — NEVER local Docker (retired),
# NEVER prod (V2 monolith `abjabuniwkqpfsenxljp`, incompatible lineage).
```

For any multi-device feature, **reproduce across two real surfaces** (a second tab is not enough for realtime channel bugs) before claiming it works.

## When to escalate / flag

- A proposal needs a **new order/payment write path** → don't bypass the canonical RPCs; extend them or flag the design first.
- A proposal touches **money on a retry-able tap** without idempotency → flag, it's a double-charge waiting to happen.
- About to **relax `orders.session_id NOT NULL`** or any CHECK on orders/payments → flag; S24/S25 correctives show these relaxations hide latent bugs across the tablet/b2b paths.
- A realtime feature can't be reproduced on a second device → not done; the bug is hiding in channel naming or mount lifecycle.
- The RPC version you find disagrees with this skill → trust the code, note the drift, and consider that the skill needs an update.
