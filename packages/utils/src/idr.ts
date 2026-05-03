// packages/utils/src/idr.ts
export function roundIdr(amount: number): number {
  if (amount < 0) {
    return -Math.round(-amount / 100) * 100;
  }
  return Math.round(amount / 100) * 100;
}

export function formatIdr(amount: number): string {
  const isNegative = amount < 0;
  const absStr = Math.abs(amount).toLocaleString('en-US');
  return `${isNegative ? '-' : ''}Rp ${absStr}`;
}
