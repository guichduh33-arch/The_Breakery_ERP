// apps/pos/src/features/settings/POSSettingsPage.tsx
//
// Session 14 — Phase 2.D — POS-side settings page.
//
// Visual ref: 88-…-modal.jpg (note: the screenshot is mis-named — it is
// actually the POS Settings full page, not a modal). Layout per ref:
//
//   ┌──────────────────────────────────────────────────────────┐
//   │ [icon] POS Settings                              ←Back   │
//   ├──────────────────────────────────────────────────────────┤
//   │ [ POS ] [ Printing ] [ KDS & Display ] [ Devices ]       │  ← sub-tabs
//   ├──────────────────────────────────────────────────────────┤
//   │ [icon] POS Configuration                                 │
//   │ Configure POS behavior, payment presets, role …          │
//   │                                                          │
//   │ [ General ] [ Automation ] [ Advanced ] [ Behavior ]     │
//   │ ── Quick Payment Amounts                                 │
//   │   [ IDR 50,000 ▲▼ 🗑 ] [ IDR 100,000 ▲▼ 🗑 ] …            │
//   │ ── Shift Opening Cash Presets                            │
//   │   [ IDR 100,000 ▲▼ 🗑 ] [ IDR 200,000 ▲▼ 🗑 ] …           │
//   │ ── Quick Discount Presets                                │
//   │   ◉ 5%  ◉ 10%  ◉ 15% …                                   │
//   └──────────────────────────────────────────────────────────┘
//
// Per Session 14 scope: this is the UX shell ONLY. Settings persistence is
// owned by the BO settings module (Phase 6.A). Here we render the canonical
// form so admins can review it on the POS terminal.

import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Settings,
  Cog,
  Printer,
  Monitor,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ShoppingCart,
  Zap,
  Tag,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { formatIdr } from '@breakery/utils';
import { Button, SectionLabel, Card, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';

type TopTab = 'pos' | 'printing' | 'kds' | 'devices';
type ConfigTab = 'general' | 'automation' | 'advanced' | 'behavior';

const DEFAULT_QUICK_PAYMENTS = [50_000, 100_000, 150_000, 200_000, 500_000];
const DEFAULT_OPENING_CASH = [100_000, 200_000, 300_000, 500_000, 1_000_000];
const DEFAULT_DISCOUNTS = [
  { value: 5, name: '5%' },
  { value: 10, name: '10%' },
  { value: 15, name: '15%' },
  { value: 20, name: '20%' },
  { value: 25, name: '25%' },
  { value: 50, name: 'Staff Meal' },
];

export default function POSSettingsPage(): JSX.Element {
  const navigate = useNavigate();
  const canEdit = useAuthStore((s) => s.hasPermission('settings.update'));
  const [topTab, setTopTab] = useState<TopTab>('pos');

  return (
    <div className="min-h-screen flex flex-col bg-bg-base text-text-primary">
      <header className="h-14 px-4 flex items-center gap-3 border-b border-border-subtle bg-bg-elevated">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back"
          onClick={() => navigate('/pos')}
          data-testid="pos-settings-back"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Button>
        <Settings className="h-5 w-5 text-gold" aria-hidden />
        <h1 className="font-display text-lg">POS Settings</h1>
        {!canEdit && (
          <span className="ml-2 text-xs uppercase tracking-widest text-text-muted inline-flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" aria-hidden /> Read only
          </span>
        )}
      </header>

      <nav
        aria-label="Settings sections"
        className="px-4 flex items-center gap-1 border-b border-border-subtle"
      >
        <TopTabButton icon={Cog} label="POS" active={topTab === 'pos'} onClick={() => setTopTab('pos')} />
        <TopTabButton icon={Printer} label="Printing" active={topTab === 'printing'} onClick={() => setTopTab('printing')} />
        <TopTabButton icon={Monitor} label="KDS & Display" active={topTab === 'kds'} onClick={() => setTopTab('kds')} />
        <TopTabButton icon={ShoppingCart} label="Devices" active={topTab === 'devices'} onClick={() => setTopTab('devices')} />
      </nav>

      <main className="flex-1 overflow-y-auto p-6">
        {topTab === 'pos' && <PosConfigSection readOnly={!canEdit} />}
        {topTab === 'printing' && <PlaceholderSection title="Printing" />}
        {topTab === 'kds' && <PlaceholderSection title="KDS & Display" />}
        {topTab === 'devices' && <PlaceholderSection title="Devices" />}
      </main>
    </div>
  );
}

function TopTabButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-2 px-4 h-12 -mb-px',
        'border-b-2 transition-colors motion-reduce:transition-none text-sm',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-[-2px]',
        active
          ? 'border-gold text-gold font-semibold'
          : 'border-transparent text-text-secondary hover:text-text-primary',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      <span>{label}</span>
    </button>
  );
}

function PosConfigSection({ readOnly }: { readOnly: boolean }): JSX.Element {
  const [tab, setTab] = useState<ConfigTab>('general');
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl inline-flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-gold" aria-hidden />
          POS Configuration
        </h2>
        <p className="text-text-secondary text-sm mt-1">
          Configure POS behavior, payment presets, and role requirements.
        </p>
      </div>

      <div className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-bg-elevated p-1">
        <SubTabButton icon={Cog} label="General" active={tab === 'general'} onClick={() => setTab('general')} />
        <SubTabButton icon={Zap} label="Automation" active={tab === 'automation'} onClick={() => setTab('automation')} />
        <SubTabButton icon={ShoppingCart} label="Advanced" active={tab === 'advanced'} onClick={() => setTab('advanced')} />
        <SubTabButton icon={Tag} label="Behavior" active={tab === 'behavior'} onClick={() => setTab('behavior')} />
      </div>

      {tab === 'general' && <GeneralTab readOnly={readOnly} />}
      {tab === 'automation' && <PlaceholderInline title="Automation" />}
      {tab === 'advanced' && <PlaceholderInline title="Advanced" />}
      {tab === 'behavior' && <PlaceholderInline title="Behavior" />}
    </div>
  );
}

function SubTabButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-2 px-3 h-8 rounded-md text-xs font-semibold',
        'transition-colors motion-reduce:transition-none',
        active ? 'bg-gold text-bg-base' : 'text-text-secondary hover:text-text-primary',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span>{label}</span>
    </button>
  );
}

function GeneralTab({ readOnly }: { readOnly: boolean }): JSX.Element {
  return (
    <div className="space-y-6">
      <PresetGroup
        title="Quick Payment Amounts"
        description="Buttons displayed in the payment terminal cash entry step."
        presets={DEFAULT_QUICK_PAYMENTS}
        readOnly={readOnly}
      />
      <PresetGroup
        title="Shift Opening Cash Presets"
        description="Tap-to-fill amounts shown when opening a new shift."
        presets={DEFAULT_OPENING_CASH}
        readOnly={readOnly}
      />
      <DiscountPresets readOnly={readOnly} />
    </div>
  );
}

function PresetGroup({
  title,
  description,
  presets,
  readOnly,
}: {
  title: string;
  description?: string;
  presets: number[];
  readOnly: boolean;
}): JSX.Element {
  return (
    <Card variant="default" padding="md" className="space-y-4">
      <div>
        <SectionLabel size="sm" as="h3" className="text-text-primary normal-case tracking-normal font-serif text-base">
          {title}
        </SectionLabel>
        {description && <p className="text-text-secondary text-xs mt-0.5">{description}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <PresetChip key={p} amount={p} readOnly={readOnly} />
        ))}
      </div>
      {!readOnly && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">IDR</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="e.g. 50000"
            className="h-9 flex-1 max-w-xs rounded-md border border-border-subtle bg-bg-base px-3 text-sm focus:outline focus:outline-2 focus:outline-gold"
            aria-label={`New ${title} preset`}
          />
          <Button variant="secondary" size="sm">
            <Plus className="h-4 w-4" aria-hidden /> Add
          </Button>
        </div>
      )}
    </Card>
  );
}

function PresetChip({ amount, readOnly }: { amount: number; readOnly: boolean }): JSX.Element {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-bg-base h-9 px-3 text-sm font-semibold">
      <span className="font-mono tabular-nums">{formatIdr(amount)}</span>
      {!readOnly && (
        <span className="ml-1 inline-flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Move up"
            className="text-text-muted hover:text-text-primary p-1"
          >
            <ArrowUp className="h-3 w-3" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Move down"
            className="text-text-muted hover:text-text-primary p-1"
          >
            <ArrowDown className="h-3 w-3" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Remove"
            className="text-red/80 hover:text-red p-1"
          >
            <Trash2 className="h-3 w-3" aria-hidden />
          </button>
        </span>
      )}
    </div>
  );
}

function DiscountPresets({ readOnly }: { readOnly: boolean }): JSX.Element {
  return (
    <Card variant="default" padding="md" className="space-y-3">
      <div>
        <SectionLabel size="sm" as="h3" className="text-text-primary normal-case tracking-normal font-serif text-base">
          Quick Discount Presets
        </SectionLabel>
        <p className="text-text-secondary text-xs mt-0.5">
          Named discount buttons shown in the POS discount modal.
        </p>
      </div>
      <ul className="space-y-1">
        {DEFAULT_DISCOUNTS.map((d) => (
          <li
            key={d.name}
            className="flex items-center gap-3 rounded-md border border-border-subtle bg-bg-base/40 px-3 py-2"
          >
            <Tag className="h-4 w-4 text-gold" aria-hidden />
            <span className="font-mono text-sm font-semibold w-12 tabular-nums">{d.value}%</span>
            <span className="text-sm text-text-secondary">{d.name}</span>
            <span className="flex-1" />
            {!readOnly && (
              <button
                type="button"
                aria-label="Remove"
                className="text-red/80 hover:text-red p-1"
              >
                <Trash2 className="h-3 w-3" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Name (e.g. Staff Meal)"
            className="h-9 flex-1 max-w-xs rounded-md border border-border-subtle bg-bg-base px-3 text-sm focus:outline focus:outline-2 focus:outline-gold"
            aria-label="New discount preset name"
          />
          <input
            type="number"
            inputMode="numeric"
            placeholder="%"
            className="h-9 w-24 rounded-md border border-border-subtle bg-bg-base px-3 text-sm focus:outline focus:outline-2 focus:outline-gold"
            aria-label="New discount preset percent"
          />
          <Button variant="secondary" size="sm">
            <Plus className="h-4 w-4" aria-hidden /> Add
          </Button>
        </div>
      )}
      <p className="text-xs text-text-muted">
        Leave the name empty to default to the percentage value (e.g. "10%").
      </p>
    </Card>
  );
}

function PlaceholderInline({ title }: { title: string }): JSX.Element {
  return (
    <Card variant="default" padding="md">
      <SectionLabel size="sm" as="h3">{title}</SectionLabel>
      <p className="text-text-secondary text-sm mt-2">
        This section is configured via the backoffice settings module.
      </p>
    </Card>
  );
}

function PlaceholderSection({ title }: { title: string }): JSX.Element {
  return (
    <Card variant="default" padding="lg">
      <h2 className="font-display text-xl">{title}</h2>
      <p className="text-text-secondary text-sm mt-2">
        Manage {title.toLowerCase()} configuration from the backoffice settings module.
        This page mirrors the canonical configuration in read-only form on the terminal.
      </p>
    </Card>
  );
}
