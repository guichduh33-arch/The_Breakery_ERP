/** Même quantum que le ledger ; les calculs restent décimaux jusqu'à l'arrondi final. */
const STOCK_SCALE = 9;
const STOCK_FACTOR = 1_000_000_000n;
export const STOCK_PRECISION_MESSAGE = 'An ingredient requirement is below the supported stock precision. Check the production quantity and recipe units.';

interface Decimal { coefficient: bigint; scale: number }

function decimal(value: number): Decimal {
  if (!Number.isFinite(value)) throw new Error('invalid_stock_quantity');
  // Number arrive de PostgREST : sa représentation décimale évite de multiplier
  // en flottant. La précision éventuellement perdue au transport n'est pas restaurable.
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) throw new Error('invalid_stock_quantity');
  const fraction = match[3] ?? '';
  const scale = fraction.length - Number(match[4] ?? 0);
  const coefficient = BigInt(`${match[1]}${match[2]}${fraction}`);
  return scale < 0
    ? { coefficient: coefficient * 10n ** BigInt(-scale), scale: 0 }
    : { coefficient, scale };
}

function add(left: Decimal, right: Decimal): Decimal {
  const scale = Math.max(left.scale, right.scale);
  return {
    coefficient: left.coefficient * 10n ** BigInt(scale - left.scale)
      + right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  };
}

function quantize(value: Decimal): bigint {
  if (value.scale <= STOCK_SCALE) return value.coefficient * 10n ** BigInt(STOCK_SCALE - value.scale);
  const divisor = 10n ** BigInt(value.scale - STOCK_SCALE);
  const absolute = value.coefficient < 0n ? -value.coefficient : value.coefficient;
  const rounded = (absolute + divisor / 2n) / divisor;
  return value.coefficient < 0n ? -rounded : rounded;
}

/** Agrège les chemins d'un matériau pour UN item, puis quantifie UNE fois comme PostgreSQL. */
export function productionRequirementQuanta(perUnit: readonly number[], produced: number, waste = 0): bigint {
  const quantity = add(decimal(produced), decimal(waste));
  const material = perUnit.reduce((sum, value) => add(sum, decimal(value)), { coefficient: 0n, scale: 0 });
  const raw = { coefficient: material.coefficient * quantity.coefficient, scale: material.scale + quantity.scale };
  const result = quantize(raw);
  if (raw.coefficient > 0n && result === 0n) throw new Error('quantity_below_stock_precision');
  return result;
}

export function stockQuantityQuanta(value: number): bigint { return quantize(decimal(value)); }

/** Conversion réservée au rendu, après calcul et comparaison des quanta. */
export function stockQuantaValue(value: bigint): number { return Number(value) / Number(STOCK_FACTOR); }
