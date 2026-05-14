// apps/pos/src/features/stock/components/POSStockCategoriesSettings.tsx
//
// Session 14 — Phase 2.D — Local-toggle modal letting the cashier hide
// non-tracked categories from the cafe stock grid.
//
// Visual ref: 73-cafe-stock-categories-settings.jpg.
//
// Scope per Session 14 task: this is a UX shell — toggles update local
// state only. Persistence to backend (terminal_settings.tracked_categories)
// is deferred to a future session (BO already owns the canonical category
// list at /backoffice/products/categories).

import { useEffect, useState, type JSX } from 'react';
import { X } from 'lucide-react';
import {
  Button,
  CenterModal,
  DialogDescription,
  DialogTitle,
  cn,
} from '@breakery/ui';

export interface POSStockCategoryToggle {
  slug: string;
  name: string;
  enabled: boolean;
}

export interface POSStockCategoriesSettingsProps {
  open: boolean;
  onClose: () => void;
  categories: POSStockCategoryToggle[];
  onSave: (next: POSStockCategoryToggle[]) => void;
}

export function POSStockCategoriesSettings({
  open,
  onClose,
  categories,
  onSave,
}: POSStockCategoriesSettingsProps): JSX.Element {
  const [draft, setDraft] = useState<POSStockCategoryToggle[]>(categories);

  // Re-seed draft when categories prop changes (e.g. data refresh).
  useEffect(() => {
    if (open) setDraft(categories);
  }, [open, categories]);

  function toggle(slug: string): void {
    setDraft((prev) => prev.map((c) => (c.slug === slug ? { ...c, enabled: !c.enabled } : c)));
  }

  return (
    <CenterModal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      data-testid="pos-stock-categories-modal"
    >
      <header className="px-5 py-4 flex items-start justify-between border-b border-border-subtle">
        <div>
          <DialogTitle className="font-display text-lg">Cafe Stock Categories</DialogTitle>
          <DialogDescription className="text-text-secondary text-sm mt-0.5">
            Toggle which POS categories are tracked in the cafe live stock system.
          </DialogDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="h-5 w-5" aria-hidden />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {draft.length === 0 ? (
          <p className="text-text-muted text-sm">No categories defined.</p>
        ) : (
          <ul className="space-y-2">
            {draft.map((c) => (
              <li
                key={c.slug}
                className="flex items-center justify-between rounded-md border border-border-subtle bg-bg-base/40 px-3 py-2.5"
              >
                <div className="text-sm font-medium text-text-primary">{c.name}</div>
                <ToggleSwitch
                  checked={c.enabled}
                  onChange={() => toggle(c.slug)}
                  ariaLabel={`Toggle ${c.name}`}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="px-5 py-4 border-t border-border-subtle flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="gold" onClick={() => onSave(draft)} data-testid="pos-stock-categories-save">
          Done
        </Button>
      </footer>
    </CenterModal>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2',
        checked ? 'bg-gold' : 'bg-bg-overlay border border-border-subtle',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
