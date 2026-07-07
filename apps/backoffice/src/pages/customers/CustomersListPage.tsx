// apps/backoffice/src/pages/customers/CustomersListPage.tsx
//
// Session 14 / Phase 5.B — Customers BO list page.
//
// Mirrors docs/Design/backoffice/customer.jpg:
//   - Header: title + Categories / Template / Import / Export / + New Customer
//   - Hero search (full-width)
//   - 4 KpiTiles : Total customers / Active this month / Loyalty members /
//     Outstanding B2B
//   - Filter bar : Category / Loyalty Tier / Sort by
//   - Table with avatar + name (+ phone), category chip, tier badge, points,
//     total spent, last visit
//
// Mutations stay through the existing CustomerFormModal which writes to
// `customers` directly — Session 14 spec D-W6-CUST-01 still applies (no
// dedicated create_customer RPC yet, raw inserts are RLS-protected).

import { Link, useNavigate } from 'react-router-dom';
import { useMemo, useState, type JSX } from 'react';
import {
  Calendar,
  ChevronDown,
  Download,
  FileText,
  Heart,
  Plus,
  Search,
  Tag,
  Upload,
  Users,
} from 'lucide-react';
import {
  Button,
  Card,
  DataTable,
  KpiTile,
  LoyaltyBadge,
  type DataTableColumn,
} from '@breakery/ui';
import { tierFromLifetime } from '@breakery/domain';
import { formatIdr } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import { CustomerAvatar } from '@/features/customers/components/CustomerAvatar.js';
import { CustomerCategoryChip } from '@/features/customers/components/CustomerCategoryChip.js';
import {
  useCustomersList,
  type CustomersListRow,
  type CustomersTier,
  type CustomersSort,
} from '@/features/customers/hooks/useCustomersList.js';
import { useCustomerCategories } from '@/features/customers/hooks/useCustomerCategories.js';
import { useCustomersStats } from '@/features/customers/hooks/useCustomersStats.js';
import { CustomerFormModal } from '@/features/loyalty/components/CustomerFormModal.js';
import { toast } from 'sonner';
import { ImportEntityModal } from '@/features/data-import/components/ImportEntityModal.js';
import { buildTemplateWorkbook, buildExportWorkbook, downloadWorkbook } from '@/features/data-import/buildEntityWorkbook.js';
import { customersImportDef } from '@/features/customers/import/customersImportDef.js';
import { useCustomersExport } from '@/features/customers/hooks/useCustomersExport.js';

const TIER_OPTIONS: readonly { value: CustomersTier; label: string }[] = [
  { value: 'all',      label: 'Loyalty Tier: All' },
  { value: 'bronze',   label: 'Bronze' },
  { value: 'silver',   label: 'Silver' },
  { value: 'gold',     label: 'Gold' },
  { value: 'platinum', label: 'Platinum' },
];

const SORT_OPTIONS: readonly { value: CustomersSort; label: string }[] = [
  { value: 'last_visit', label: 'Sort by: Last Visit' },
  { value: 'name',       label: 'Sort by: Name (A→Z)' },
  { value: 'spend',      label: 'Sort by: Total Spent' },
  { value: 'points',     label: 'Sort by: Points' },
];

function formatLastVisit(iso: string | null): string {
  if (iso === null) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default function CustomersListPage(): JSX.Element {
  const navigate      = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead       = hasPermission('customers.read');
  const canCreate     = hasPermission('customers.create');
  const canManageCats = hasPermission('customer_categories.read');

  const [search,     setSearch    ] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [tier,       setTier      ] = useState<CustomersTier>('all');
  const [sort,       setSort      ] = useState<CustomersSort>('last_visit');
  const [creating,   setCreating  ] = useState<boolean>(false);
  const [importing,  setImporting ] = useState<boolean>(false);
  const exportMut = useCustomersExport();

  const filters = useMemo(
    () => ({
      ...(search !== '' ? { search } : {}),
      categoryId,
      tier,
      sort,
    }),
    [search, categoryId, tier, sort],
  );

  const list  = useCustomersList(filters);
  const cats  = useCustomerCategories();
  const stats = useCustomersStats();

  function handleTemplate(): void {
    downloadWorkbook(buildTemplateWorkbook(customersImportDef), 'breakery-customers-template.xlsx');
  }
  async function handleExport(): Promise<void> {
    try {
      const rows = await exportMut.mutateAsync();
      downloadWorkbook(
        buildExportWorkbook(customersImportDef, rows),
        `breakery-customers-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    }
  }

  if (!canRead) {
    return (
      <div className="text-text-secondary">
        You do not have permission to view customers.
      </div>
    );
  }

  const columns: readonly DataTableColumn<CustomersListRow>[] = [
    {
      id:     'customer',
      header: 'Customer name',
      width:  '28%',
      render: (row) => (
        <div className="flex items-center gap-3">
          <CustomerAvatar name={row.name} />
          <div className="leading-tight">
            <div className="font-medium text-text-primary">{row.name}</div>
            {row.phone !== null && (
              <div className="text-xs text-text-secondary">{row.phone}</div>
            )}
          </div>
        </div>
      ),
    },
    {
      id:     'category',
      header: 'Category',
      align:  'center',
      render: (row) => (
        <CustomerCategoryChip name={row.category_name} slug={row.category_slug} />
      ),
    },
    {
      id:     'tier',
      header: 'Loyalty tier',
      align:  'center',
      render: (row) => {
        const t = tierFromLifetime(row.lifetime_points);
        return <LoyaltyBadge tier={t} points={row.loyalty_points} />;
      },
    },
    {
      id:     'credit',
      header: 'Credit',
      align:  'center',
      render: (row) =>
        row.customer_type === 'b2b' && row.b2b_current_balance > 0 ? (
          <span className="inline-flex rounded-md bg-warning-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-warning">
            Yes
          </span>
        ) : (
          <span className="inline-flex rounded-md bg-bg-overlay px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-text-muted">
            No
          </span>
        ),
    },
    {
      id:     'points',
      header: 'Points',
      align:  'right',
      render: (row) => (
        <span className="font-mono text-sm">{row.loyalty_points.toLocaleString()}</span>
      ),
    },
    {
      id:     'spent',
      header: 'Total spent',
      align:  'right',
      render: (row) => (
        <span className="font-mono text-sm">{formatIdr(row.total_spent)}</span>
      ),
    },
    {
      id:     'last',
      header: 'Last visit',
      align:  'right',
      render: (row) => (
        <span className="text-xs text-text-secondary">{formatLastVisit(row.last_visit_at)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl text-text-primary">Customers</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Manage your bakery&apos;s customer relationships and loyalty tiers.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManageCats && (
            <Button asChild variant="ghost" size="md">
              <Link to="/backoffice/customers/categories">
                <Tag className="h-4 w-4" aria-hidden /> Categories
              </Link>
            </Button>
          )}
          <Button variant="ghost" size="md" onClick={handleTemplate} aria-label="Download customers template">
            <FileText className="h-4 w-4" aria-hidden /> Template
          </Button>
          {canCreate && (
            <Button variant="ghost" size="md" onClick={() => setImporting(true)} aria-label="Import customers">
              <Upload className="h-4 w-4" aria-hidden /> Import
            </Button>
          )}
          <Button variant="ghost" size="md" onClick={() => void handleExport()} disabled={exportMut.isPending} aria-label="Export customers">
            <Download className="h-4 w-4" aria-hidden /> {exportMut.isPending ? 'Exporting…' : 'Export'}
          </Button>
          {canCreate && (
            <Button variant="primary" size="md" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden /> New Customer
            </Button>
          )}
        </div>
      </header>

      <Card variant="default" padding="sm">
        <div className="flex items-center gap-2 text-text-secondary">
          <Search className="h-4 w-4" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or phone…"
            maxLength={64}
            aria-label="Search customers"
            className="h-9 w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          icon={Users}
          label="Total customers"
          value={stats.data?.totalCustomers ?? 0}
          valueFormat="number"
        />
        <KpiTile
          icon={Calendar}
          label="Active this month"
          value={stats.data?.activeThisMonth ?? 0}
          valueFormat="number"
          footer="Unique visits recorded"
        />
        <KpiTile
          icon={Heart}
          label="Loyalty members"
          value={stats.data?.loyaltyMembers ?? 0}
          valueFormat="number"
          footer={`${stats.data?.loyaltyPercent ?? 0}% of total base`}
        />
        <KpiTile
          icon={FileText}
          label="Outstanding B2B"
          value={stats.data?.outstandingB2b ?? 0}
          valueFormat="currency"
          footer={`${stats.data?.outstandingCount ?? 0} unpaid wholesale invoices`}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <FilterSelect
          label="Category"
          value={categoryId ?? ''}
          onChange={(v) => setCategoryId(v === '' ? null : v)}
          options={[
            { value: '', label: 'Category: All' },
            ...((cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))),
          ]}
        />
        <FilterSelect
          label="Loyalty tier"
          value={tier}
          onChange={(v) => setTier(v as CustomersTier)}
          options={TIER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
        <FilterSelect
          label="Sort"
          value={sort}
          onChange={(v) => setSort(v as CustomersSort)}
          options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
      </div>

      {list.error !== null && list.error !== undefined ? (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          Failed: {list.error.message}
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={list.data ?? []}
          getRowKey={(r) => r.id}
          isLoading={list.isLoading}
          onRowClick={(row) => navigate(`/backoffice/customers/${row.id}`)}
          emptyTitle="No customers match"
          emptyDescription="Adjust the filters above or invite your first customer."
          data-testid="customers-table"
        />
      )}

      <CustomerFormModal
        open={creating}
        mode="create"
        onClose={() => setCreating(false)}
      />
      <ImportEntityModal
        open={importing}
        onClose={() => setImporting(false)}
        def={customersImportDef}
        title="Import customers"
        description="Upload a filled .xlsx template. New customers are created; duplicates (by phone or email) are flagged before any writes."
      />
    </div>
  );
}

interface FilterSelectProps {
  label:    string;
  value:    string;
  options:  readonly { value: string; label: string }[];
  onChange: (next: string) => void;
}

function FilterSelect({ label, value, options, onChange }: FilterSelectProps): JSX.Element {
  return (
    <Card variant="default" padding="none">
      <label className="flex items-center justify-between gap-2 px-4 py-2.5">
        <span className="sr-only">{label}</span>
        <select
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-sm text-text-primary outline-none"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown className="h-4 w-4 text-text-muted" aria-hidden />
      </label>
    </Card>
  );
}
