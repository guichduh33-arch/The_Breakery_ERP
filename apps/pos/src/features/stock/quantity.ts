/** Display quantities share the database numeric(10,3) contract. */
export function isDisplayQuantity(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 9_999_999.999
    && (value === 0 || value >= 0.001)
    && Math.abs(value - Math.round(value * 1000) / 1000) <= 1e-10;
}
