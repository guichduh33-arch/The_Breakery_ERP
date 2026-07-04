// apps/backoffice/src/features/suppliers/components/SupplierPaymentDistribution.tsx
//
// Donut chart for the supplier Payments tab — paid vs overdue split.

import type { JSX } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatIdr } from '@breakery/utils';

const PAID = 'var(--success)';
const OVERDUE = 'var(--danger)';

export interface SupplierPaymentDistributionProps {
  paidAmount: number;
  overdueAmount: number;
}

export function SupplierPaymentDistribution({
  paidAmount,
  overdueAmount,
}: SupplierPaymentDistributionProps): JSX.Element {
  const data = [
    { name: 'overdue', value: overdueAmount, color: OVERDUE },
    { name: 'paid', value: paidAmount, color: PAID },
  ].filter((d) => d.value > 0);

  return (
    <div>
      <h3 className="mb-3 font-display text-base text-text-primary">Payment Distribution</h3>
      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-muted">No payment data.</p>
      ) : (
        <>
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none">
                  {data.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
                <Tooltip formatter={(v: number, n: string) => [formatIdr(v), n]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex items-center justify-center gap-4 text-xs">
            {data.map((d) => (
              <span key={d.name} className="inline-flex items-center gap-1.5 capitalize text-text-secondary">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: d.color }} /> {d.name}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
