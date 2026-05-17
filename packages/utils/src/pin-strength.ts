// packages/utils/src/pin-strength.ts
// Session 19 / Phase 2.B — PIN strength evaluator (Thread C).
//
// Pure, IO-free TypeScript per CLAUDE.md domain-package convention.
// MIRROR : supabase/functions/_shared/pin-strength.ts (Deno copy ;
// kept in sync via _shared_pin-strength_sync.test.ts).
//
// Decision refs : D10 (live in utils), D12 (top-100 leaked list inlined),
// D13 (warn-only — this util has no opinion on enforce).

export type PinWeakReason = 'sequence' | 'repetition' | 'common' | null;

export interface PinStrengthResult {
  weak: boolean;
  reason: PinWeakReason;
}

const COMMON_PINS: ReadonlySet<string> = new Set([
  // Top ~100 leaked PINs (Datagenetics 2012 dataset, curated).
  // 6-digit subset (the EF requires exactly 6).
  '123456', '111111', '000000', '123123', '654321', '666666', '121212', '696969',
  '112233', '159753', '147258', '789456', '101010', '252525', '131313', '142536',
  '202020', '232323', '545454', '252627', '987654', '102030', '030303', '040404',
  '050505', '060606', '070707', '080808', '090909', '987456', '852456', '741741',
  '321321', '456789', '321654', '555555', '777777', '888888', '999999', '333333',
  '444444', '222222', '141414', '161616', '171717', '181818', '191919', '212121',
  '232425', '343434', '353535', '363636', '373737', '383838', '393939', '414141',
  '424242', '434343', '454545', '464646', '474747', '484848', '494949', '515151',
  '525252', '535353', '565656', '575757', '585858', '595959', '616161', '626262',
  '636363', '646464', '656565', '676767', '686868', '717171', '727272', '737373',
  '747474', '757575', '767676', '787878', '797979', '818181', '828282', '838383',
  '848484', '858585', '868686', '878787', '898989', '919191', '929292', '939393',
  '949494', '959595', '969696', '979797', '989898',
]);

/**
 * Evaluate a 6-digit PIN against weak-pattern heuristics.
 * Returns { weak: false, reason: null } for any input not matching format
 * (caller is responsible for format validation upstream).
 */
export function evaluatePinStrength(pin: string | null | undefined): PinStrengthResult {
  if (typeof pin !== 'string' || pin.length < 4) {
    return { weak: false, reason: null };
  }
  if (!/^\d+$/.test(pin)) {
    return { weak: false, reason: null };
  }

  // Repetition : all digits identical.
  if (/^(\d)\1+$/.test(pin)) {
    return { weak: true, reason: 'repetition' };
  }

  // Sequence : strictly +1 or -1 step throughout.
  let asc = true;
  let desc = true;
  for (let i = 1; i < pin.length; i++) {
    const a = Number(pin[i - 1]);
    const b = Number(pin[i]);
    if (b - a !== 1)  asc  = false;
    if (a - b !== 1)  desc = false;
  }
  if (asc || desc) {
    return { weak: true, reason: 'sequence' };
  }

  // Common leaked PIN.
  if (COMMON_PINS.has(pin)) {
    return { weak: true, reason: 'common' };
  }

  return { weak: false, reason: null };
}
