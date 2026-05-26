// apps/backoffice/src/pages/reports/Pb1ReportPage.tsx
// S30 Wave 4.2 — PB1 (10% monthly restaurant tax) report with month/year selector + export.
//
// S31 : period cell terminal — drilling to JE list filtered by date range would require
// /accounting/journal-entries to accept date_from/date_to as URL params (currently uses
// local state only). Deferred to S32+ (JE page bump).

import { useState } from 'react';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import {
  usePb1Report,
  type Pb1ByDay,
} from '@/features/reports/hooks/usePb1Report.js';

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const csvColumns: CsvColumn<Pb1ByDay>[] = [
  { header: 'Date',            accessor: (r) => r.day,           format: 'text' },
  { header: 'Taxable base',    accessor: (r) => r.taxable_base,  format: 'idr-round100' },
  { header: 'PB1 collected',   accessor: (r) => r.pb1_collected, format: 'idr-round100' },
];

function currentMonth(): number { return new Date().getMonth() + 1; }
function currentYear():  number { return new Date().getFullYear(); }

export default function Pb1ReportPage() {
  const [month, setMonth] = useState<number>(currentMonth);
  const [year,  setYear]  = useState<number>(currentYear);

  const { data, isLoading, error } = usePb1Report({ month, year });

  const titlePeriod = MONTHS[month] ? `${MONTHS[month]} ${year}` : `${month}/${year}`;

  return (
    <ReportPage
      title="PB1 Report"
      subtitle="Monthly restaurant tax (PB1 10%) — NON-PKP mode."
      filters={
        <div className="flex items-center gap-3">
          {/* Month selector */}
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <span>Month</span>
            <select
              className="h-9 rounded-md border border-border-subtle bg-surface px-2 text-sm text-text-primary"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              aria-label="Select month"
            >
              {MONTHS.slice(1).map((name, idx) => (
                <option key={idx + 1} value={idx + 1}>{name}</option>
              ))}
            </select>
          </label>
          {/* Year selector */}
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <span>Year</span>
            <input
              type="number"
              className="h-9 w-24 rounded-md border border-border-subtle bg-surface px-2 text-sm text-text-primary"
              value={year}
              min={2020}
              max={2099}
              onChange={(e) => setYear(Number(e.target.value))}
              aria-label="Select year"
            />
          </label>
          {data && (
            <ExportButtons
              csv={{ rows: data.by_day, columns: csvColumns, filename: `pb1-${year}-${String(month).padStart(2, '0')}` }}
              pdf={{
                template: 'pb1',
                data,
                period: { start: data.period.start, end: data.period.end },
                filename: `pb1-${year}-${String(month).padStart(2, '0')}`,
              }}
            />
          )}
        </div>
      }
    >
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error.message ?? 'Failed to load report.'}
        </p>
      )}
      {data && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: 'PB1 rate',        value: `${(data.pb1_rate * 100).toFixed(0)}%` },
              { label: 'Taxable base',    value: data.taxable_base.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }) },
              { label: 'PB1 collected',   value: data.pb1_collected.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }) },
              { label: 'PB1 payable',     value: data.pb1_payable.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }) },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg border border-border-subtle bg-surface-raised p-4">
                <p className="text-xs text-text-secondary uppercase tracking-wide">{label}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>

          {/* By-day table */}
          <div>
            <h2 className="mb-2 text-sm font-medium uppercase tracking-widest text-text-secondary">
              {titlePeriod} — by day
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-text-secondary">
                  <th className="py-2 text-left">Date</th>
                  <th className="py-2 text-right">Taxable base</th>
                  <th className="py-2 text-right">PB1 collected</th>
                </tr>
              </thead>
              <tbody>
                {data.by_day.length === 0 && (
                  <tr>
                    <td className="py-3 text-text-secondary" colSpan={3}>
                      No sales recorded for this month.
                    </td>
                  </tr>
                )}
                {data.by_day.map((d) => (
                  <tr key={d.day} className="border-b border-border-subtle">
                    <td className="py-2 text-text-secondary">{String(d.day).slice(0, 10)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {d.taxable_base.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {d.pb1_collected.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ReportPage>
  );
}
