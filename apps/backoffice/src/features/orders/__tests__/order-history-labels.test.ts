// La frise de commande doit nommer chaque geste que la base trace sur une
// commande. Ce test lit les SOURCES (migrations + EF refund-order) : une action
// d'audit neuve sans libellé fait échouer la suite au lieu de s'afficher en
// code brut dans la frise. Il a été écrit après que `order.complete` (émis) a
// été cherché sous `order.completed` (jamais émis) pendant des mois.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORDER_HISTORY_LABELS, buildOrderHistory, type OrderAuditEvent } from '../orderHistory.js';
import type { OrderDetail } from '../hooks/useOrderDetail.js';

const REPO = join(__dirname, '..', '..', '..', '..', '..', '..');
// Chiffres admis : `b2b.order.*` en porte un, et un motif sans eux l'ignorait.
const ORDER_ENTITY = /'([a-z0-9_]+(?:\.[a-z0-9_]+)+)',\s*'(?:orders?|order_items?)'/g;
// Une action choisie par `CASE … THEN 'a' ELSE 'b' END, 'orders'` : chaque
// littéral du CASE est une action émise.
const CASE_ENTITY = /CASE\s([\s\S]{0,400}?)\sEND,\s*'(?:orders?|order_items?)'/g;
const LITERAL = /'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'/g;
// Préfixes des actions d'audit. Les autres couples « 'x.y', 'orders' » des
// migrations sont des codes de permission (`orders.read`, module `orders`).
const AUDIT_PREFIX = /^(order|kds|je|pos|refund|b2b\.order)\./;

function emittedOrderActions(): Set<string> {
  const actions = new Set<string>();
  const dir = join(REPO, 'supabase', 'migrations');
  const sources = readdirSync(dir).filter((name) => name.endsWith('.sql')).map((name) => join(dir, name));
  sources.push(join(REPO, 'supabase', 'functions', 'refund-order', 'index.ts'));
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(ORDER_ENTITY)) {
      if (AUDIT_PREFIX.test(match[1]!)) actions.add(match[1]!);
    }
    for (const match of text.matchAll(CASE_ENTITY)) {
      for (const literal of match[1]!.matchAll(LITERAL)) {
        if (AUDIT_PREFIX.test(literal[1]!)) actions.add(literal[1]!);
      }
    }
  }
  // L'EF écrit un objet, pas un tuple SQL : sa forme est `action: 'refund.replay'`.
  const ef = readFileSync(join(REPO, 'supabase', 'functions', 'refund-order', 'index.ts'), 'utf8');
  for (const match of ef.matchAll(/action:\s*'([a-z0-9_.]+)'/g)) actions.add(match[1]!);
  return actions;
}

describe('Order history labels', () => {
  it('names every audit action the database records on an order', () => {
    const emitted = emittedOrderActions();
    expect(emitted.size).toBeGreaterThan(15);
    expect(emitted).toContain('order.complete');
    // Garde du relevé lui-même : les trois formes (tuple, CASE, EF) sont vues.
    expect(emitted).toContain('b2b.order.cancelled');
    expect(emitted).toContain('b2b.order.delivered');
    expect(emitted).toContain('refund.replay');
    const missing = [...emitted].filter((action) => !(action in ORDER_HISTORY_LABELS)).sort();
    expect(missing).toEqual([]);
  });

  it('shows the raw code instead of a generic label for an unknown action', () => {
    const order = {
      id: 'o', created_at: '2026-11-03T01:00:00Z', status: 'completed', paid_at: '2026-11-03T01:05:00Z',
      sent_to_kitchen_at: null, items: [], payments: [], refunds: [],
    } as unknown as OrderDetail;
    const event: OrderAuditEvent = {
      id: 9, action: 'order.something_new', actor_id: null, entity_id: 'o',
      created_at: '2026-11-03T01:02:00Z', metadata: {}, actor: null,
    };
    expect(buildOrderHistory(order, [event]).find((entry) => entry.id === 'audit-9'))
      .toMatchObject({ label: 'Recorded action: order.something_new' });
  });
});
