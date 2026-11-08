import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutContext } from '../../functions/_shared/pdf-layout.ts';
import { render } from '../../functions/_shared/pdf-templates/audit.ts';

const mocks = vi.hoisted(() => ({ drawText: vi.fn(), drawFooter: vi.fn() }));
vi.mock('https://esm.sh/pdf-lib@1.17.1', () => ({ rgb: () => ({}) }));
vi.mock('../../functions/_shared/pdf-layout.ts', () => ({
  drawHeader: () => 780, drawFooter: mocks.drawFooter,
}));

const context = {
  doc: { addPage: () => ({ drawText: mocks.drawText, drawLine: vi.fn(), drawRectangle: vi.fn() }) },
  font: { getCharacterSet: () => [...Array.from({ length: 224 }, (_, code) => code + 32), 0x2026, 0x2014],
    widthOfTextAtSize: (text: string) => text.length * 4 },
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
  it.each(['\n', '\r\n'])('keeps %j line breaks as separate lines while escaping unsupported text', async (newline) => {
    const id = 'audit:12345678-1234-4234-8234-123456789abc';
    await render(context, [{ id, created_at: '2026-11-04T12:00:00Z',
      action: 'pos.item_added', description: `Item added · 茶${newline}Quantity verified`,
      source_label: 'POS activity', review_cue: 'Check receipt', entity_type: 'order',
      actor_id: 'profile-id', actor_name: '李', actor_context: 'Recorded actor' }], null);
    const event = mocks.drawText.mock.calls.filter(([, options]) => options.x === 150);
    expect(event.map(([value]) => value)).toEqual([
      'Event / review cue', 'Item added · [U+8336]', 'Quantity verified',
      'POS activity', `Event: ${id}`, 'Review: Check receipt',
    ]);
    const actor = mocks.drawText.mock.calls.filter(([, options]) => options.x === 475);
    expect(actor.map(([value]) => value)).toEqual(['Account', '[U+674E]', 'Recorded actor']);
    const rowY = event.slice(1).map(([, options]) => options.y);
    expect(rowY).toEqual(rowY.map((_, i) => rowY[0] - i * 11));
    expect(actor.slice(1).map(([, options]) => options.y)).toEqual(rowY.slice(0, 2));
    expect(mocks.drawText.mock.calls.some(([value]) => /\[U\+[AD]\]|[\r\n]/.test(value))).toBe(false);
  });
  it('uses the business date across a UTC midnight boundary', async () => {
    await render(context, [{ id: 'audit:1', created_at: '2026-11-06T23:30:00Z',
      action: 'shift.close', entity_type: 'pos_session', actor_id: null }], null);
    expect(mocks.drawText.mock.calls.map(([value]) => value)).toContain('2026-11-07 07:30');
  });
  it('preserves long descriptions and review cues across pages with exact footer totals', async () => {
    const description = 'Register discrepancy: counted cash 0; expected cash 500000; verify the final manager approval.';
    await render(context, Array.from({ length: 50 }, (_, i) => ({ id: `audit:${i}`,
      created_at: '2026-11-07T00:00:00Z', action: 'shift.close', entity_type: 'pos_session',
      actor_id: null, description, source_label: 'Server audit', review_cue: 'Compare with the bank deposit.' })), null);
    const text = mocks.drawText.mock.calls.filter(([, options]) => options.x === 150).map(([value]) => value).join(' ');
    expect(text).toContain('verify the final manager approval.');
    expect(text).toContain('Compare with the bank deposit.');
    const footers = mocks.drawFooter.mock.calls;
    expect(footers.length).toBeGreaterThan(1);
    expect(footers.every((args, i) => args[2] === i + 1 && args[3] === footers.length)).toBe(true);
  });
});
