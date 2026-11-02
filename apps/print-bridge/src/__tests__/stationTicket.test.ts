import { describe, it, expect, vi } from 'vitest';
import type { StationTicketPayload } from '@breakery/domain';
import { ThermalPrinter, PrinterTypes } from 'node-thermal-printer';
import { renderStationTicket } from '../render/stationTicket.js';
import { makeFake } from './receipt.test.js';

const BASE: StationTicketPayload = {
  kind: 'prep',
  role: 'kitchen',
  order_number: 'A-042',
  table_number: '5',
  created_at: '2026-07-06T09:30:00Z',
  server_name: 'Ayu',
  items: [
    { name: 'Croque Monsieur', quantity: 2, modifiers: ['No onions'], note: 'allergy: nuts' },
    { name: 'Omelette', quantity: 1 },
  ],
};

function printedLines(width = 48) {
  const { p, log } = makeFake();
  let size: [number, number] = [0, 0];
  const lines: { text: string; size: [number, number] }[] = [];
  p.getWidth = () => width;
  p.setTextSize = (height, columns) => { size = [height, columns]; };
  p.setTextNormal = () => { size = [0, 0]; };
  p.println = (text) => { lines.push({ text, size: [...size] }); };
  return { p, log, lines };
}

describe('renderStationTicket', () => {
  it.each(['kitchen', 'barista', 'display'] as const)(
    'prints quantities, names, modifiers and notes at double height and width for %s', (role) => {
      const { p, lines } = printedLines();
      renderStationTicket(p, { ...BASE, role });
      for (const text of ['2x Croque Monsieur', '  + No onions', '  ! allergy: nuts', '1x Omelette']) {
        expect(lines.find((line) => line.text === text)?.size).toEqual([1, 1]);
      }
      // Le ticket suivant ne doit pas hériter de l'agrandissement.
      p.println('next ticket');
      expect(lines.at(-1)?.size).toEqual([0, 0]);
    },
  );

  it.each([32, 42, 48])('wraps all long KOT text within a %s-column printer without losing content', (width) => {
    const { p, lines } = printedLines(width);
    const item = {
      quantity: 12,
      name: 'Croque Monsieur with smoked chicken and extra mature cheddar',
      modifiers: ['Extra cheese and mushrooms without onions or tomato'],
      note: 'ALLERGY: peanuts and sesame. Keep the sauce separately.\nNo butter, please.',
    };
    renderStationTicket(p, { ...BASE, order_number: 'ORDER-123456789012345678901234567890', items: [item] });
    const itemStart = lines.findIndex((line) => line.text.startsWith('12x'));
    const itemLines = lines.slice(itemStart);
    const normalized = (text: string) => text.replace(/\s/g, '');
    expect(normalized(itemLines.map((line) => line.text).join(''))).toBe(
      normalized(`12x ${item.name}  + ${item.modifiers[0]}  ! ${item.note}`),
    );
    const enlarged = lines.filter((line) => line.size[1] === 1);
    expect(enlarged.length).toBeGreaterThan(4);
    expect(enlarged.every((line) => Array.from(line.text).length <= Math.floor(width / 2))).toBe(true);
    expect(normalized(enlarged.map((line) => line.text).join(''))).toContain(
      '#ORDER-123456789012345678901234567890',
    );
  });

  it('keeps an unbroken long word, accents and explicit newlines in the KOT', () => {
    const { p, lines } = printedLines(32);
    const name = 'Crème brûlée ' + 'S'.repeat(90);
    renderStationTicket(p, { ...BASE, items: [{ quantity: 1, name, note: 'first\r\nsecond\rthird' }] });
    const itemStart = lines.findIndex((line) => line.text.startsWith('1x'));
    const text = lines.slice(itemStart).map((line) => line.text).join('');
    expect(text.replace(/\s/g, '')).toBe(`1x${name.replace(/\s/g, '')}!firstsecondthird`);
    expect(lines.filter((line) => line.size[1] === 1).every((line) => Array.from(line.text).length <= 16)).toBe(true);
  });

  it('uses actual ESC/POS double-size bytes and the driver width without opening a connection', () => {
    const printer = new ThermalPrinter({ type: PrinterTypes.EPSON, interface: 'tcp://127.0.0.1:9100', width: 32 });
    const println = vi.spyOn(printer, 'println');
    const name = 'ABCDEFGHIJKLMNO'.repeat(4);
    renderStationTicket(printer, { ...BASE, items: [{ quantity: 1, name }] });
    const bytes = printer.getBuffer();
    // GS ! 0x11 : largeur ×2 et hauteur ×2 ; le driver compte toujours 32 colonnes.
    expect(bytes.includes(Buffer.from([0x1d, 0x21, 0x11]))).toBe(true);
    const lines = println.mock.calls.map(([text]) => text);
    const itemLines = lines.slice(lines.indexOf('1x'));
    expect(itemLines.join('')).toBe('1x' + name);
    expect(itemLines.every((line) => line.length <= 16)).toBe(true);
    for (const line of itemLines) expect(bytes.includes(Buffer.from(line + '\n'))).toBe(true);
  });

  it('keeps waiter item text at normal size and does not wrap it as a KOT', () => {
    const { p, lines } = printedLines(32);
    const name = 'Waiter consolidated item with its full long product name';
    renderStationTicket(p, { ...BASE, kind: 'waiter', role: 'waiter', items: [{ quantity: 1, name }] });
    expect(lines.find((line) => line.text === '1x ' + name)?.size).toEqual([0, 0]);
  });

  it('prints a closing report with received methods and duplicate marker', () => {
    const { p, log } = makeFake();
    renderStationTicket(p, { ...BASE, kind: 'shift_close', role: 'cashier', duplicate: true,
      report_lines: [{ label: 'CASH', amount: 30000 }, { label: 'Outstanding collected', amount: 90000 }] });
    expect(log.join('\n')).toContain('SHIFT CLOSING REPORT');
    expect(log.join('\n')).toContain('CASH | 30.000');
    expect(log.join('\n')).toContain('Outstanding collected | 90.000');
    expect(log.join('\n')).toContain('*** DUPLICATE ***');
    expect(log.at(-1)).toBe('<cut>');
  });
  it('renders station header, order, table, items with modifiers and notes', () => {
    const { p, log } = makeFake();
    renderStationTicket(p, BASE);
    const flat = log.join('\n');
    expect(flat).toContain('KITCHEN');
    expect(flat).toContain('#A-042');
    expect(flat).toContain('Table 5');
    expect(flat).toContain('2x Croque Monsieur');
    expect(flat).toContain('  + No onions');
    expect(flat).toContain('  ! allergy: nuts');
    expect(log[log.length - 1]).toBe('<cut>');
  });

  it('renders the ADDITIONAL ORDER banner when additional=true', () => {
    const { p, log } = makeFake();
    renderStationTicket(p, { ...BASE, additional: true });
    expect(log.join('\n')).toContain('*** ADDITIONAL ORDER ***');
  });

  it('waiter ticket shows WAITER header, no table line when absent', () => {
    const { p, log } = makeFake();
    const { table_number: _table_number, ...baseWithoutTable } = BASE;
    renderStationTicket(p, { ...baseWithoutTable, kind: 'waiter', role: 'waiter' });
    const flat = log.join('\n');
    expect(flat).toContain('WAITER');
    expect(flat).not.toContain('Table');
  });
});
