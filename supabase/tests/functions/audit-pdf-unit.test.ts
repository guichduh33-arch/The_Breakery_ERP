import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutContext } from '../../functions/_shared/pdf-layout.ts';
import { render } from '../../functions/_shared/pdf-templates/audit.ts';

const mocks = vi.hoisted(() => ({ drawText: vi.fn() }));
vi.mock('https://esm.sh/pdf-lib@1.17.1', () => ({ rgb: () => ({}) }));
vi.mock('../../functions/_shared/pdf-layout.ts', () => ({
  drawHeader: () => 780, drawFooter: () => undefined,
}));

const context = {
  doc: { addPage: () => ({ drawText: mocks.drawText, drawLine: vi.fn(), drawRectangle: vi.fn() }) },
  font: { getCharacterSet: () => [...Array.from({ length: 256 }, (_, code) => code), 0x2026, 0x2014] },
  fontBold: {}, business: { name: 'The Breakery' },
} as unknown as LayoutContext;

describe('audit PDF names and descriptions', () => {
  beforeEach(() => vi.clearAllMocks());
  it('prints the supplied user name and readable description', async () => {
    await render(context, [{ id: 'audit:1', created_at: '2026-11-04T12:00:00Z',
      action: 'order.reopened', description: 'Order reopened', entity_type: 'order',
      actor_id: 'profile-id', actor_name: 'Made' }], null);
    const text = mocks.drawText.mock.calls.map(([value]) => value);
    expect(text).toContain('Order reopened');
    expect(text).toContain('Made');
    expect(text).not.toContain('…ofile-id');
  });
  it('still accepts legacy export rows', async () => {
    await render(context, [{ id: '1', created_at: '2026-11-04T12:00:00Z',
      action: 'order.reopened', entity_type: 'order', actor_id: null }], null);
    expect(mocks.drawText.mock.calls.map(([value]) => value)).toContain('order.reopened');
  });
  it('escapes characters outside the font instead of failing the entire export', async () => {
    await render(context, [{ id: 'audit:1', created_at: '2026-11-04T12:00:00Z',
      action: 'pos.item_added', description: 'Item added · 茶', entity_type: 'order',
      actor_id: 'profile-id', actor_name: '李' }], null);
    const text = mocks.drawText.mock.calls.map(([value]) => value);
    expect(text).toContain('[U+674E]');
    expect(text).toContain('Item added · [U+8336]');
  });
});
