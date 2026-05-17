// supabase/tests/functions/_shared_pin-strength_sync.test.ts
// Session 19 / Phase 2.B — Detects drift between packages/utils/src/pin-strength.ts
// and supabase/functions/_shared/pin-strength.ts.

import { describe, it, expect } from 'vitest';
import { evaluatePinStrength as evalUtil } from '../../../packages/utils/src/pin-strength';
import { evaluatePinStrength as evalDeno } from '../../functions/_shared/pin-strength';

const SENTINELS: ReadonlyArray<string> = [
  '123456', '111111', '000000', '654321', '121212', '696969', '147258',
  '285741', '936027', '472913', '601834', 'abcd56', '', '11',
];

describe('pin-strength util/_shared sync', () => {
  for (const pin of SENTINELS) {
    it(`returns same result for "${pin || '<empty>'}"`, () => {
      const u = evalUtil(pin);
      const d = evalDeno(pin);
      expect(d).toEqual(u);
    });
  }
});
