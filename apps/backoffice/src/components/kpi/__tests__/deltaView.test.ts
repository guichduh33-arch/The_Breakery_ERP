// apps/backoffice/src/components/kpi/__tests__/deltaView.test.ts
//
// Critique design 2026-08-26 — une variation non plafonnée sortait « ▲ 5.158,2% ».
// Le chiffre a l'air d'une mesure ; il ne dit en réalité qu'une chose : la
// période de référence était quasi vide. Les preuves ci-dessous tiennent les
// DEUX bords — le plafond ne doit pas manger les variations qui, elles, mesurent
// quelque chose, et la doctrine du tiret cadratin (donnée absente ≠ zéro) reste
// intacte.

import { describe, it, expect } from 'vitest';
import { deltaView, DELTA_CAP_HINT } from '../deltaView.js';

describe('deltaView', () => {
  it('caps a runaway positive variation and carries the reason', () => {
    const d = deltaView(5158.2);
    expect(d.text).toBe('>999%');
    expect(d.direction).toBe('up');
    expect(d.glyph).toBe('▲');
    expect(d.hint).toBe(DELTA_CAP_HINT);
  });

  it('caps a runaway negative variation while keeping the sign on the glyph', () => {
    const d = deltaView(-4000);
    expect(d.text).toBe('>999%');
    expect(d.direction).toBe('down');
    expect(d.glyph).toBe('▼');
    expect(d.hint).toBe(DELTA_CAP_HINT);
  });

  it('leaves a variation AT the cap exact — the cap starts beyond it', () => {
    const d = deltaView(999);
    expect(d.text).toBe('999,0%');
    expect(d.hint).toBeUndefined();
  });

  it('caps the points unit with its own suffix', () => {
    expect(deltaView(1200, 'pt').text).toBe('>999pt');
  });

  it('keeps ordinary variations untouched and unexplained', () => {
    const d = deltaView(12.4);
    expect(d.text).toBe('12,4%');
    expect(d.hint).toBeUndefined();
  });

  // La doctrine du tiret cadratin ne bouge pas : une donnée absente ne se rend
  // jamais en « 0,0% », et le plafond ne s'y applique pas.
  it('still renders an absent comparison as an em dash, never as zero', () => {
    for (const v of [null, undefined, Number.NaN]) {
      const d = deltaView(v);
      expect(d.direction).toBe('none');
      expect(d.text).toBe('—');
      expect(d.hint).toBeUndefined();
    }
  });
});
