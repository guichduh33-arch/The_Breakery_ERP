// apps/pos/src/features/settings/POSSettingsPage.tsx
//
// Session 14 — Phase 2.D — POS-side settings page.
//
// Reviewer follow-up #18 — preset groups now persist via the
// pos_presets symbolic category on get_settings_by_category_v5 /
// set_setting_v7 (see usePOSPresets hook + migrations
// 20260518000002 / 20260518000003).
//
// Visual ref: 88-…-modal.jpg (note: the screenshot is mis-named — it is
// actually the POS Settings full page, not a modal). Layout per ref.

import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
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
  Tag,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { formatIdr } from '@breakery/utils';
import { Button, SectionLabel, Card, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';
import { usePOSPresets, type DiscountPreset } from './hooks/usePOSPresets';
import { ScopeBadge } from './components/ScopeBadge';
import { PrintingSettingsTab } from './components/PrintingSettingsTab';
import { BehaviorSettingsTab } from './components/BehaviorSettingsTab';
import { AdvancedSettingsTab } from './components/AdvancedSettingsTab';
import { DevicesSettingsTab } from './components/DevicesSettingsTab';
import { DisplaySettingsTab } from './components/DisplaySettingsTab';

type TopTab = 'pos' | 'printing' | 'kds' | 'devices';
type ConfigTab = 'general' | 'advanced' | 'behavior';

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
        <TopTabButton icon={Monitor} label="Customer Display" active={topTab === 'kds'} onClick={() => setTopTab('kds')} />
        <TopTabButton icon={ShoppingCart} label="Devices" active={topTab === 'devices'} onClick={() => setTopTab('devices')} />
      </nav>

      <main className="flex-1 overflow-y-auto p-6">
        {topTab === 'pos' && <PosConfigSection readOnly={!canEdit} />}
        {topTab === 'printing' && <PrintingSettingsTab readOnly={!canEdit} />}
        {topTab === 'kds' && <DisplaySettingsTab readOnly={!canEdit} />}
        {topTab === 'devices' && <DevicesSettingsTab readOnly={!canEdit} />}
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
        <SubTabButton icon={ShoppingCart} label="Advanced" active={tab === 'advanced'} onClick={() => setTab('advanced')} />
        <SubTabButton icon={Tag} label="Behavior" active={tab === 'behavior'} onClick={() => setTab('behavior')} />
      </div>

      {tab === 'general' && <GeneralTab readOnly={readOnly} />}
      {tab === 'advanced' && <AdvancedSettingsTab readOnly={readOnly} />}
      {tab === 'behavior' && <BehaviorSettingsTab readOnly={readOnly} />}
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
  const {
    presets,
    isLoading,
    error,
    mutateQuickPayments,
    mutateOpeningCash,
    mutateDiscountPresets,
  } = usePOSPresets();

  if (isLoading) {
    return (
      <div className="space-y-6" data-testid="pos-presets-loading">
        <PresetSkeleton />
        <PresetSkeleton />
        <PresetSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <Card variant="default" padding="md" data-testid="pos-presets-error">
        <p className="text-red text-sm">
          Could not load POS presets — using fallback defaults. Check your connection and try again.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <ScopeBadge scope="org" />
        <span className="text-xs text-text-muted">Presets partagés par tous les terminaux.</span>
      </div>
      <NumericPresetGroup
        title="Quick Payment Amounts"
        description="Buttons displayed in the payment terminal cash entry step."
        presets={presets.quickPayments}
        readOnly={readOnly}
        isPending={mutateQuickPayments.isPending}
        onChange={(next) => {
          mutateQuickPayments.mutate(next, {
            onSuccess: () => toast.success('Quick payment amounts saved'),
            onError: (e) => toast.error(`Save failed: ${e.message}`),
          });
        }}
      />
      <NumericPresetGroup
        title="Shift Opening Cash Presets"
        description="Tap-to-fill amounts shown when opening a new shift."
        presets={presets.openingCashPresets}
        readOnly={readOnly}
        isPending={mutateOpeningCash.isPending}
        onChange={(next) => {
          mutateOpeningCash.mutate(next, {
            onSuccess: () => toast.success('Opening cash presets saved'),
            onError: (e) => toast.error(`Save failed: ${e.message}`),
          });
        }}
      />
      <DiscountPresetsGroup
        presets={presets.discountPresets}
        readOnly={readOnly}
        isPending={mutateDiscountPresets.isPending}
        onChange={(next) => {
          mutateDiscountPresets.mutate(next, {
            onSuccess: () => toast.success('Discount presets saved'),
            onError: (e) => toast.error(`Save failed: ${e.message}`),
          });
        }}
      />
    </div>
  );
}

function PresetSkeleton(): JSX.Element {
  return (
    <Card variant="default" padding="md" className="space-y-3">
      <div className="h-4 w-48 bg-bg-input rounded animate-pulse" />
      <div className="h-3 w-72 bg-bg-input rounded animate-pulse" />
      <div className="flex gap-2 pt-2">
        <div className="h-9 w-32 bg-bg-input rounded animate-pulse" />
        <div className="h-9 w-32 bg-bg-input rounded animate-pulse" />
        <div className="h-9 w-32 bg-bg-input rounded animate-pulse" />
      </div>
    </Card>
  );
}

function NumericPresetGroup({
  title,
  description,
  presets,
  readOnly,
  isPending,
  onChange,
}: {
  title: string;
  description?: string;
  presets: number[];
  readOnly: boolean;
  isPending: boolean;
  onChange: (next: number[]) => void;
}): JSX.Element {
  const [draft, setDraft] = useState('');

  function moveUp(idx: number): void {
    if (idx <= 0) return;
    const next = presets.slice();
    [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
    onChange(next);
  }
  function moveDown(idx: number): void {
    if (idx >= presets.length - 1) return;
    const next = presets.slice();
    [next[idx + 1], next[idx]] = [next[idx]!, next[idx + 1]!];
    onChange(next);
  }
  function remove(idx: number): void {
    const next = presets.slice();
    next.splice(idx, 1);
    if (next.length === 0) {
      toast.error('At least one preset is required');
      return;
    }
    onChange(next);
  }
  function add(): void {
    const value = Number(draft);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Enter a positive amount');
      return;
    }
    if (presets.includes(value)) {
      toast.error('Preset already exists');
      return;
    }
    onChange([...presets, value]);
    setDraft('');
  }

  return (
    <Card variant="default" padding="md" className="space-y-4">
      <div>
        <SectionLabel size="sm" as="h3" className="text-text-primary normal-case tracking-normal font-serif text-base">
          {title}
        </SectionLabel>
        {description && <p className="text-text-secondary text-xs mt-0.5">{description}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {presets.map((p, idx) => (
          <PresetChip
            key={`${p}-${idx}`}
            amount={p}
            readOnly={readOnly || isPending}
            canMoveUp={idx > 0}
            canMoveDown={idx < presets.length - 1}
            onMoveUp={() => moveUp(idx)}
            onMoveDown={() => moveDown(idx)}
            onRemove={() => remove(idx)}
          />
        ))}
      </div>
      {!readOnly && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">IDR</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="e.g. 50000"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-9 flex-1 max-w-xs rounded-md border border-border-subtle bg-bg-base px-3 text-sm focus:outline focus:outline-2 focus:outline-gold"
            aria-label={`New ${title} preset`}
          />
          <Button variant="secondary" size="sm" onClick={add} disabled={isPending || draft.trim() === ''}>
            <Plus className="h-4 w-4" aria-hidden /> Add
          </Button>
        </div>
      )}
    </Card>
  );
}

function PresetChip({
  amount,
  readOnly,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  amount: number;
  readOnly: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-bg-base h-9 px-3 text-sm font-semibold">
      <span className="font-mono tabular-nums">{formatIdr(amount)}</span>
      {!readOnly && (
        <span className="ml-1 inline-flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Move up"
            disabled={!canMoveUp}
            onClick={onMoveUp}
            className="text-text-muted hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-muted p-1"
          >
            <ArrowUp className="h-3 w-3" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Move down"
            disabled={!canMoveDown}
            onClick={onMoveDown}
            className="text-text-muted hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-muted p-1"
          >
            <ArrowDown className="h-3 w-3" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Remove"
            onClick={onRemove}
            className="text-red/80 hover:text-red p-1"
          >
            <Trash2 className="h-3 w-3" aria-hidden />
          </button>
        </span>
      )}
    </div>
  );
}

function DiscountPresetsGroup({
  presets,
  readOnly,
  isPending,
  onChange,
}: {
  presets: DiscountPreset[];
  readOnly: boolean;
  isPending: boolean;
  onChange: (next: DiscountPreset[]) => void;
}): JSX.Element {
  const [draftName, setDraftName] = useState('');
  const [draftPct, setDraftPct] = useState('');

  function remove(idx: number): void {
    const next = presets.slice();
    next.splice(idx, 1);
    if (next.length === 0) {
      toast.error('At least one preset is required');
      return;
    }
    onChange(next);
  }
  function add(): void {
    const value = Number(draftPct);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      toast.error('Percentage must be between 0 and 100');
      return;
    }
    const name = draftName.trim() === '' ? `${value}%` : draftName.trim();
    if (presets.some((p) => p.name === name)) {
      toast.error('Preset name already exists');
      return;
    }
    onChange([...presets, { value, name }]);
    setDraftName('');
    setDraftPct('');
  }

  return (
    <Card variant="default" padding="md" className="space-y-3">
      <div>
        <SectionLabel size="sm" as="h3" className="text-text-primary normal-case tracking-normal font-serif text-base">
          Quick Discount Presets
        </SectionLabel>
        <p className="text-text-secondary text-xs mt-0.5">
          Named discount buttons shown in the POS discount modal.
        </p>
        <p className="text-text-muted text-xs mt-1 italic">
          Shown as one-tap presets in the POS discount modal (cart & line).
        </p>
      </div>
      <ul className="space-y-1">
        {presets.map((d, idx) => (
          <li
            key={`${d.name}-${idx}`}
            className="flex items-center gap-3 rounded-md border border-border-subtle bg-bg-base/40 px-3 py-2"
          >
            <Tag className="h-4 w-4 text-gold" aria-hidden />
            <span className="font-mono text-sm font-semibold w-12 tabular-nums">{d.value}%</span>
            <span className="text-sm text-text-secondary">{d.name}</span>
            <span className="flex-1" />
            {!readOnly && (
              <button
                type="button"
                aria-label={`Remove ${d.name}`}
                onClick={() => remove(idx)}
                disabled={isPending}
                className="text-red/80 hover:text-red disabled:opacity-30 p-1"
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
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            className="h-9 flex-1 max-w-xs rounded-md border border-border-subtle bg-bg-base px-3 text-sm focus:outline focus:outline-2 focus:outline-gold"
            aria-label="New discount preset name"
          />
          <input
            type="number"
            inputMode="numeric"
            placeholder="%"
            value={draftPct}
            onChange={(e) => setDraftPct(e.target.value)}
            className="h-9 w-24 rounded-md border border-border-subtle bg-bg-base px-3 text-sm focus:outline focus:outline-2 focus:outline-gold"
            aria-label="New discount preset percent"
          />
          <Button variant="secondary" size="sm" onClick={add} disabled={isPending || draftPct.trim() === ''}>
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

