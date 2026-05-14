// apps/backoffice/src/pages/btob/B2BPaymentsPage.tsx
//
// Session 14 / Phase 5.B — B2B Payments page.
//
// Mirrors docs/Design/backoffice/btob payment.jpg :
//   - Header: title + back link
//   - 4 KpiTiles: Total Received / Outstanding / Payments Received / Overdue
//   - Tabs: Received / Outstanding / Aging Report
//   - Search + filter card
//   - Empty list (no b2b_payments table yet)
//
// SCOPE: there is no `b2b_payments` table in the V3 schema. The "Outstanding"
// tab reads from customers.b2b_current_balance. The "Received" tab is empty
// with a tracker note (D-W6-B2BPAY-01). Once the b2b_payments table lands
// the empty list flips to the live ledger without changing this file's
// surface.

import { Link } from 'react-router-dom';
import { useState, type JSX } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock,
  CreditCard,
  Search,
  TrendingUp,
} from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  KpiTile,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import { useB2bDashboard, type B2bClientRow } from '@/features/btob/hooks/useB2bDashboard.js';

type TabKey = 'received' | 'outstanding' | 'aging';

export default function B2BPaymentsPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead = hasPermission('customers.read');
  const dash = useB2bDashboard();
  const [tab,    setTab   ] = useState<TabKey>('received');
  const [search, setSearch] = useState<string>('');
  const [method, setMethod] = useState<string>('all');
  const [period, setPeriod] = useState<string>('all');

  if (!canRead) {
    return <div className="text-text-secondary">No access to B2B Payments.</div>;
  }

  const totalOutstanding = dash.data?.outstandingAr ?? 0;
  const aging = dash.data?.aging ?? [];
  const overdueCount = aging
    .filter((b) => b.label !== 'Current')
    .reduce((acc, b) => acc + b.count, 0);

  const filteredOutstanding = (dash.data?.topClients ?? [])
    .filter((c) => Number(c.b2b_current_balance) > 0)
    .filter((c) => search === '' || c.name.toLowerCase().includes(search.toLowerCase())
      || (c.b2b_company_name ?? '').toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button asChild variant="ghost" size="sm" aria-label="Back to B2B dashboard">
            <Link to="/backoffice/b2b">
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <div>
            <h1 className="font-serif text-3xl text-text-primary inline-flex items-center gap-2">
              <CreditCard className="h-6 w-6 text-gold" aria-hidden /> B2B Payments
            </h1>
            <p className="mt-1 text-sm text-text-secondary">Manage payments and receivables tracking</p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiTile icon={TrendingUp}  label="Total received"     value={0}                valueFormat="currency" />
        <KpiTile icon={Clock}       label="Outstanding"        value={totalOutstanding} valueFormat="currency" />
        <KpiTile icon={CheckCircle2} label="Payments received" value={0}                valueFormat="number" />
        <KpiTile icon={AlertCircle} label="Overdue"            value={overdueCount}     valueFormat="number" />
      </div>

      <Card variant="default" padding="none">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className="border-b border-border-subtle px-3">
            <TabsTrigger value="received">
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Received (0)
            </TabsTrigger>
            <TabsTrigger value="outstanding">
              <Clock className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Outstanding ({filteredOutstanding.length})
            </TabsTrigger>
            <TabsTrigger value="aging">
              <AlertCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Aging report
            </TabsTrigger>
          </TabsList>

          <div className="space-y-3 p-4">
            <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-base px-3">
              <Search className="h-4 w-4 text-text-secondary" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="h-9 w-full bg-transparent text-sm text-text-primary outline-none"
                aria-label="Search payments"
              />
            </div>
            <FilterRow
              label="All methods"
              value={method}
              onChange={setMethod}
              options={[
                { value: 'all',      label: 'All methods' },
                { value: 'cash',     label: 'Cash' },
                { value: 'transfer', label: 'Bank transfer' },
                { value: 'qris',     label: 'QRIS' },
                { value: 'card',     label: 'Card' },
              ]}
            />
            <FilterRow
              label="All dates"
              value={period}
              onChange={setPeriod}
              options={[
                { value: 'all',  label: 'All dates' },
                { value: '7d',   label: 'Last 7 days' },
                { value: '30d',  label: 'Last 30 days' },
                { value: 'mtd',  label: 'Month to date' },
              ]}
            />
          </div>

          <TabsContent value="received">
            <div className="border-t border-border-subtle">
              <EmptyState
                icon={CreditCard}
                title="No payments"
                description="Received payments will appear here."
                size="md"
              />
              <p className="px-6 pb-4 text-center text-[10px] uppercase tracking-widest text-text-muted">
                A `b2b_payments` ledger is tracked as deviation D-W6-B2BPAY-01 for Session 15+.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="outstanding">
            <div className="border-t border-border-subtle">
              {filteredOutstanding.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="No outstanding balances" size="md" />
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {filteredOutstanding.map((c) => (
                    <OutstandingRow key={c.id} client={c} />
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>

          <TabsContent value="aging">
            <div className="border-t border-border-subtle p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                {aging.map((b) => (
                  <div key={b.label} className="rounded-md border border-border-subtle bg-bg-base/40 p-3">
                    <div className="text-xs font-semibold uppercase tracking-widest text-text-secondary">{b.label}</div>
                    <div className="mt-1 text-xs text-text-muted">{b.range}</div>
                    <div className="mt-2 font-mono text-lg text-text-primary">{formatIdr(b.total)}</div>
                    <div className="text-xs text-text-secondary">{b.count} clients</div>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}

function OutstandingRow({ client }: { client: B2bClientRow }): JSX.Element {
  const overLimit = client.b2b_credit_limit !== null
    && Number(client.b2b_current_balance) > Number(client.b2b_credit_limit);
  return (
    <li className="flex items-center justify-between px-4 py-3 text-sm">
      <div>
        <div className="font-medium text-text-primary">{client.b2b_company_name ?? client.name}</div>
        <div className="text-xs text-text-secondary">
          Limit: {client.b2b_credit_limit === null ? 'unlimited' : formatIdr(Number(client.b2b_credit_limit))}
        </div>
      </div>
      <div className="text-right">
        <div className={['font-mono text-base', overLimit ? 'text-danger' : 'text-amber-500'].join(' ')}>
          {formatIdr(Number(client.b2b_current_balance))}
        </div>
        {overLimit && <div className="text-[10px] uppercase tracking-widest text-danger">Over limit</div>}
      </div>
    </li>
  );
}

function FilterRow({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-base px-3">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full bg-transparent text-sm text-text-primary outline-none"
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="h-4 w-4 text-text-muted" aria-hidden />
    </label>
  );
}
