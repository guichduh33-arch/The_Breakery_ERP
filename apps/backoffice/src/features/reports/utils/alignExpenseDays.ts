// Les séries SQL sont clairsemées : aligner les jours de chaque fenêtre,
// jamais les indices des seules lignes reçues.
import { eachDay } from './reportFigures.js';

export function alignExpenseDays(
  start: string, end: string, compareStart: string, compareEnd: string,
  current: { date: string; total: number }[],
  previous: { date: string; total: number }[],
): Record<string, unknown>[] {
  const nowByDate = new Map(current.map((d) => [d.date, d.total]));
  const prevByDate = new Map(previous.map((d) => [d.date, d.total]));
  const previousDays = eachDay(compareStart, compareEnd);
  return eachDay(start, end).map((date, index) => ({
    date,
    current: nowByDate.get(date) ?? 0,
    compare: previousDays[index] === undefined ? null : prevByDate.get(previousDays[index]) ?? 0,
  }));
}
