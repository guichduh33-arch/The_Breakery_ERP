// S44 D4 — pinne la table TIERS côté TS. Le miroir SQL get_loyalty_multiplier
// (migration 20260628000010) pinne les mêmes valeurs en pgTAP : si l'une des
// deux tables bouge sans l'autre, un des deux tests casse (pattern sync S19
// pin-strength).
import { describe, it, expect } from 'vitest';
import { TIERS } from '../tiers.js';

describe('loyalty tier multipliers (S44 SQL mirror contract)', () => {
  it('pins the 4-tier multiplier table', () => {
    expect(TIERS.map((t) => [t.tier, t.min, t.points_multiplier])).toEqual([
      ['bronze', 0, 1.0],
      ['silver', 500, 1.05],
      ['gold', 2000, 1.1],
      ['platinum', 5000, 1.2],
    ]);
  });
});
