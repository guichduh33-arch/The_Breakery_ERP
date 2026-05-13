// packages/domain/src/notifications/__tests__/composeMessage.test.ts
import { describe, it, expect } from 'vitest';
import { composeMessage } from '../composeMessage';

describe('composeMessage', () => {
  it('substitutes a single placeholder', () => {
    const out = composeMessage(
      { subject_template: 'Hi {{name}}', body_template: 'Welcome, {{name}}.' },
      { name: 'Alice' },
    );
    expect(out.subject).toBe('Hi Alice');
    expect(out.body).toBe('Welcome, Alice.');
    expect(out.missingVars).toEqual([]);
  });

  it('substitutes multiple distinct placeholders', () => {
    const out = composeMessage(
      {
        subject_template: 'Order {{number}} ready',
        body_template: 'Hi {{name}}, your order {{number}} (Rp {{total}}) is ready.',
      },
      { name: 'Bob', number: 'ORD-42', total: 75_000 },
    );
    expect(out.subject).toBe('Order ORD-42 ready');
    expect(out.body).toBe('Hi Bob, your order ORD-42 (Rp 75000) is ready.');
    expect(out.missingVars).toEqual([]);
  });

  it('leaves missing placeholders in place and lists them', () => {
    const out = composeMessage(
      { subject_template: 'Hi {{name}}', body_template: 'Total: {{amount}} on {{date}}' },
      { name: 'Carol' },
    );
    expect(out.subject).toBe('Hi Carol');
    expect(out.body).toBe('Total: {{amount}} on {{date}}');
    expect(out.missingVars.sort()).toEqual(['amount', 'date']);
  });

  it('treats null as missing', () => {
    const out = composeMessage(
      { subject_template: null, body_template: 'X={{x}} Y={{y}}' },
      { x: 'ok', y: null },
    );
    expect(out.body).toBe('X=ok Y={{y}}');
    expect(out.missingVars).toEqual(['y']);
  });

  it('treats undefined as missing', () => {
    const out = composeMessage(
      { subject_template: null, body_template: 'Hello {{who}}' },
      { who: undefined },
    );
    expect(out.body).toBe('Hello {{who}}');
    expect(out.missingVars).toEqual(['who']);
  });

  it('stringifies numbers, booleans, and zero', () => {
    const out = composeMessage(
      { subject_template: null, body_template: '{{n}} / {{b}} / {{z}}' },
      { n: 42, b: false, z: 0 },
    );
    expect(out.body).toBe('42 / false / 0');
    expect(out.missingVars).toEqual([]);
  });

  it('handles repeated placeholders', () => {
    const out = composeMessage(
      { subject_template: null, body_template: '{{x}} + {{x}} = {{x}}{{x}}' },
      { x: 'a' },
    );
    expect(out.body).toBe('a + a = aa');
  });

  it('accepts whitespace inside braces', () => {
    const out = composeMessage(
      { subject_template: null, body_template: 'Hi {{ name }}!' },
      { name: 'Dee' },
    );
    expect(out.body).toBe('Hi Dee!');
  });

  it('returns template unchanged when no placeholders present', () => {
    const out = composeMessage(
      { subject_template: 'Static subject', body_template: 'Plain text body.' },
      { unused: 'x' },
    );
    expect(out.subject).toBe('Static subject');
    expect(out.body).toBe('Plain text body.');
    expect(out.missingVars).toEqual([]);
  });

  it('returns empty subject when subject_template is null and empty placeholders', () => {
    const out = composeMessage(
      { subject_template: null, body_template: 'body' },
      {},
    );
    expect(out.subject).toBe('');
    expect(out.body).toBe('body');
    expect(out.missingVars).toEqual([]);
  });

  it('ignores malformed placeholders (no closing braces)', () => {
    const out = composeMessage(
      { subject_template: null, body_template: 'Hi {{name oops' },
      { name: 'X' },
    );
    expect(out.body).toBe('Hi {{name oops');
  });

  it('does not match invalid identifiers (digits-first, hyphens)', () => {
    const out = composeMessage(
      { subject_template: null, body_template: '{{1bad}} {{good-key}}' },
      { '1bad': 'a', 'good-key': 'b' },
    );
    // Neither matches the identifier regex → no substitution, no
    // missing entries (the matcher never fires).
    expect(out.body).toBe('{{1bad}} {{good-key}}');
    expect(out.missingVars).toEqual([]);
  });

  it('deduplicates missing var names', () => {
    const out = composeMessage(
      { subject_template: '{{x}}', body_template: '{{x}} and {{x}} again' },
      {},
    );
    expect(out.missingVars).toEqual(['x']);
  });
});
