// packages/utils/src/idr.ts
// D8 (session 8 perf-debt): cache the Intl.NumberFormat instance at module
// scope so we don't re-construct (and re-parse the locale data) on every
// call. `toLocaleString` builds a fresh formatter under the hood each time —
// the cached `_fmt` skips that overhead.
//
// Locale métier : id-ID (arbitrage Mamat 2026-08-13, critique /impeccable
// lot 1 volet C). Le back-office avait convergé sur id-ID (« Rp 35.000 »,
// audit UX/UI 2026-08-13) pendant que ce fichier — la voie du POS et des
// primitives partagées Currency/KpiTile — restait en en-US (« Rp 35,000 ») :
// le même montant changeait de graphie d'une surface à l'autre. La bascule
// se fait ICI pour que les ~180 call-sites suivent d'un coup.
//
// IDR has no circulating sub-unit — amounts are always whole rupiah. Force
// zero fraction digits so a fractional input (e.g. a WAC unit cost of
// 1234.56) renders as "Rp 1.235" rather than leaking decimals into the UI.
const _fmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

export function roundIdr(amount: number): number {
  if (amount < 0) {
    return -Math.round(-amount / 100) * 100;
  }
  return Math.round(amount / 100) * 100;
}

export function formatIdr(amount: number): string {
  const isNegative = amount < 0;
  const absStr = _fmt.format(Math.abs(amount));
  return `${isNegative ? '-' : ''}Rp ${absStr}`;
}
