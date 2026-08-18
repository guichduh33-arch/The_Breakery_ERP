// apps/backoffice/src/pages/btob/B2BPaymentsPage.tsx
//
// Session 14 / Phase 5.B — B2B Payments page.
// Session 24 / Phase 2.A.4 — Received tab now consumes the `b2b_payments`
// ledger (S24 migration _010) and the page header gets a "+ Record Payment"
// button wired to RecordB2bPaymentModal. Closes deviation D-W6-B2BPAY-01.

import { useSearchParams } from 'react-router-dom';
import { useMemo, useState, type JSX } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  FileText,
  Plus,
  Search,
} from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@breakery/ui';
import { formatCurrency, formatDateTime } from '@breakery/utils';
import { PageHeader } from '@/components/PageHeader.js';
// Voir B2BDashboardPage : la tuile du back-office (23 px + `valueTitle`) et non
// celle de `@breakery/ui` (34 px), qui coupe tout montant au-delà de huit
// caractères. Un encours d'AR en fait neuf.
import { KpiTile, KPI_NOTE } from '@/components/kpi/KpiTile.js';
import { formatCount, formatIdr, formatIdrShort } from '@/features/dashboard/utils/format.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';
import { FOCUS_WITHIN_RING } from '@/components/focusRing.js';
import { useAuthStore } from '@/stores/authStore.js';
import { useB2bDashboard, type B2bClientRow } from '@/features/btob/hooks/useB2bDashboard.js';
import {
  useB2bPaymentsReceived,
  type B2bPaymentReceivedRow,
  type B2bPaymentsPeriod,
} from '@/features/btob/hooks/useB2bPaymentsReceived.js';
import { RecordB2bPaymentModal } from '@/features/btob/components/RecordB2bPaymentModal.js';
import { B2bInvoicesTab } from '@/features/btob/components/B2bInvoicesTab.js';
import { AgingBucketsGrid } from '@/features/btob/components/AgingBucketsGrid.js';

type TabKey = 'received' | 'outstanding' | 'invoices' | 'aging';

// Ordre de la fiche B2B.md §9 — le recouvrement d'abord ; Invoices reste en
// 4ᵉ : il porte le deep-link JE (?tab=invoices) et les actions par facture.
const TAB_KEYS: readonly TabKey[] = ['outstanding', 'aging', 'received', 'invoices'];

const PERIOD_LABEL: Record<B2bPaymentsPeriod, string> = {
  all: 'All dates',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  mtd: 'Month to date',
};

export default function B2BPaymentsPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('customers.read');
  const canRecord = hasPermission('b2b.payment.record');
  const dash = useB2bDashboard();
  // Session 59 / Task 6a — seed the initial tab from `?tab=` so a JE-source
  // drilldown link (reference_type b2b_*) can land straight on Invoices.
  // No 2-way sync — same pattern as GeneralLedgerPage's URL-seeded selectors.
  const [searchParams] = useSearchParams();
  const initialTabParam = searchParams.get('tab');
  const initialTab: TabKey = TAB_KEYS.includes(initialTabParam as TabKey)
    ? (initialTabParam as TabKey)
    : 'outstanding';
  const [tab,    setTab   ] = useState<TabKey>(initialTab);
  const [search, setSearch] = useState<string>('');
  const [method, setMethod] = useState<string>('all');
  const [period, setPeriod] = useState<B2bPaymentsPeriod>('all');
  const [recordOpen, setRecordOpen] = useState<boolean>(false);
  const [recordCustomerId, setRecordCustomerId] = useState<string | undefined>(undefined);
  const [recordInvoiceIds, setRecordInvoiceIds] = useState<string[] | undefined>(undefined);
  const canCancel = hasPermission('b2b.order.cancel');

  function openRecord(customerId?: string, invoiceIds?: string[]): void {
    setRecordCustomerId(customerId);
    setRecordInvoiceIds(invoiceIds);
    setRecordOpen(true);
  }

  const payments = useB2bPaymentsReceived(period);

  const filteredPayments = useMemo<B2bPaymentReceivedRow[]>(() => {
    const rows = payments.data ?? [];
    return rows.filter((r) => {
      if (method !== 'all' && r.method !== method) return false;
      if (search === '') return true;
      const q = search.toLowerCase();
      return (
        r.payment_number.toLowerCase().includes(q) ||
        (r.company_name ?? '').toLowerCase().includes(q) ||
        (r.customer_name ?? '').toLowerCase().includes(q) ||
        (r.reference     ?? '').toLowerCase().includes(q)
      );
    });
  }, [payments.data, method, search]);

  const totalReceived = useMemo(
    () => filteredPayments.reduce((acc, r) => acc + r.amount, 0),
    [filteredPayments],
  );

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
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        <span>B2B</span>
        <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
        <span className="text-text-secondary">Payments</span>
      </nav>

      <PageHeader
        title="B2B Payments"
        subtitle="Manage payments and receivables tracking"
        actions={
          <button
            type="button"
            className={TOOLBAR_BTN_PRIMARY}
            disabled={!canRecord}
            onClick={() => openRecord()}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Record Payment
          </button>
        }
      />

      {/* Un échec ou un chargement rendent des tirets, jamais des zéros (ADR-025). */}
      {dash.error !== null && (
        <p role="alert" className="rounded-md border border-red bg-red-soft p-3 text-sm text-red-as-text">
          Receivables could not be loaded — Outstanding and Aging show dashes rather
          than numbers that would be wrong.{' '}
          <button type="button" className="underline" onClick={() => { void dash.refetch(); }}>
            Try again
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Total received"
          value={payments.data === undefined ? '—' : formatIdrShort(totalReceived)}
          {...(payments.data !== undefined ? { valueTitle: formatIdr(totalReceived) } : {})}
          unavailable={payments.data === undefined}
          testId="kpi-b2b-total-received"
        >
          <span className={KPI_NOTE}>{PERIOD_LABEL[period]}</span>
        </KpiTile>
        <KpiTile
          label="Outstanding"
          value={dash.data === undefined ? '—' : formatIdrShort(totalOutstanding)}
          {...(dash.data !== undefined ? { valueTitle: formatIdr(totalOutstanding) } : {})}
          unavailable={dash.data === undefined}
          testId="kpi-b2b-outstanding"
        />
        <KpiTile
          label="Payments received"
          value={payments.data === undefined ? '—' : formatCount(filteredPayments.length)}
          unavailable={payments.data === undefined}
          testId="kpi-b2b-payments-count"
        />
        <KpiTile
          label="Overdue"
          value={dash.data === undefined ? '—' : formatCount(overdueCount)}
          unavailable={dash.data === undefined}
          testId="kpi-b2b-overdue"
        />
      </div>

      <Card variant="default" padding="none">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className="border-b border-border-subtle px-3">
            <TabsTrigger value="outstanding">
              <Clock className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Outstanding ({filteredOutstanding.length})
            </TabsTrigger>
            <TabsTrigger value="aging">
              <AlertCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Aging report
            </TabsTrigger>
            <TabsTrigger value="received">
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Received ({filteredPayments.length})
            </TabsTrigger>
            <TabsTrigger value="invoices">
              <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Invoices
            </TabsTrigger>
          </TabsList>

          {/* Chaque contrôle ne se rend que sur les onglets où il agit : la
              recherche ne parle pas à Aging, méthode/période qu'à Received. */}
          {tab !== 'aging' && (
            <div className="space-y-3 p-4">
              <div className={`flex items-center gap-2 rounded-md border border-border-subtle bg-bg-base px-3 ${FOCUS_WITHIN_RING}`}>
                <Search className="h-4 w-4 text-text-secondary" aria-hidden />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="h-9 w-full bg-transparent text-sm text-text-primary focus-visible:outline-none"
                  aria-label="Search payments"
                />
              </div>
              {tab === 'received' && (
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="b2b-payments-method" className="sr-only">Payment method</label>
                  <Select
                    id="b2b-payments-method"
                    value={method}
                    onChange={(e) => { setMethod(e.target.value); }}
                    className="w-44"
                  >
                    <option value="all">All methods</option>
                    <option value="cash">Cash</option>
                    <option value="transfer">Bank transfer</option>
                    <option value="qris">QRIS</option>
                    <option value="card">Card</option>
                  </Select>
                  <label htmlFor="b2b-payments-period" className="sr-only">Period</label>
                  <Select
                    id="b2b-payments-period"
                    value={period}
                    onChange={(e) => { setPeriod(e.target.value as B2bPaymentsPeriod); }}
                    className="w-44"
                  >
                    {Object.entries(PERIOD_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
          )}

          <TabsContent value="received">
            <div className="border-t border-border-subtle">
              {payments.error !== null ? (
                <p role="alert" className="m-4 rounded-md border border-red bg-red-soft p-3 text-sm text-red-as-text">
                  Payments could not be loaded.{' '}
                  <button type="button" className="underline" onClick={() => { void payments.refetch(); }}>
                    Try again
                  </button>
                </p>
              ) : payments.isLoading ? (
                <div className="p-6 text-sm text-text-secondary">Loading…</div>
              ) : filteredPayments.length === 0 ? (
                <EmptyState
                  icon={CreditCard}
                  title="No payments"
                  description="Received payments will appear here."
                  size="md"
                />
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {filteredPayments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div>
                        <div className="font-data text-xs tabular-nums text-text-primary">{p.payment_number}</div>
                        <div className="text-xs text-text-secondary">
                          {p.company_name ?? p.customer_name ?? 'Unknown'}
                          {' • '}
                          {formatDateTime(p.paid_at)}
                          {' • '}
                          {p.method}
                          {p.reference !== null && p.reference !== '' && (
                            <> • <span className="text-text-muted">{p.reference}</span></>
                          )}
                        </div>
                      </div>
                      <span className="font-data text-base tabular-nums text-text-primary">
                        {formatCurrency(p.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>

          <TabsContent value="outstanding">
            <div className="border-t border-border-subtle">
              {dash.isLoading ? (
                <div className="p-6 text-sm text-text-secondary">Loading…</div>
              ) : dash.error !== null ? (
                <div className="p-6 text-sm text-text-secondary" role="alert">
                  Outstanding balances could not be loaded.
                </div>
              ) : filteredOutstanding.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="No outstanding balances" size="md" />
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {filteredOutstanding.map((c) => (
                    <OutstandingRow key={c.id} client={c} canRecord={canRecord} onRecord={openRecord} />
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>

          <TabsContent value="invoices">
            <B2bInvoicesTab
              search={search}
              canRecord={canRecord}
              canCancel={canCancel}
              onRecord={openRecord}
            />
          </TabsContent>

          <TabsContent value="aging">
            <div className="border-t border-border-subtle p-4">
              {dash.isLoading ? (
                <div className="p-2 text-sm text-text-secondary">Loading…</div>
              ) : dash.error !== null ? (
                <div className="p-2 text-sm text-text-secondary" role="alert">
                  The aging report could not be loaded.
                </div>
              ) : aging.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="No outstanding receivables" size="md" />
              ) : (
                <AgingBucketsGrid buckets={aging} />
              )}
            </div>
          </TabsContent>
        </Tabs>
      </Card>

      <RecordB2bPaymentModal
        open={recordOpen}
        initialCustomerId={recordCustomerId}
        initialInvoiceIds={recordInvoiceIds}
        onClose={() => setRecordOpen(false)}
      />
    </div>
  );
}

function OutstandingRow({ client, canRecord, onRecord }: { client: B2bClientRow; canRecord: boolean; onRecord: (customerId: string) => void }): JSX.Element {
  const overLimit = client.b2b_credit_limit !== null
    && Number(client.b2b_current_balance) > Number(client.b2b_credit_limit);
  return (
    <li className="flex items-center justify-between px-4 py-3 text-sm">
      <div>
        <div className="font-medium text-text-primary">{client.b2b_company_name ?? client.name}</div>
        <div className="text-xs text-text-secondary">
          Limit: {client.b2b_credit_limit === null ? 'unlimited' : formatCurrency(Number(client.b2b_credit_limit))}
        </div>
      </div>
      <div className="text-right">
        <div className={['font-data text-base tabular-nums', overLimit ? 'text-danger' : 'text-warning'].join(' ')}>
          {formatCurrency(Number(client.b2b_current_balance))}
        </div>
        {overLimit && <div className="text-xs uppercase tracking-widest text-danger">Over limit</div>}
        {canRecord && (
          <Button variant="ghost" size="sm" onClick={() => onRecord(client.id)} data-testid={`out-record-${client.id}`}>
            Record payment
          </Button>
        )}
      </div>
    </li>
  );
}
