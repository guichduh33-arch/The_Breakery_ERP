// apps/pos/src/features/settings/components/SettingToggle.tsx
//
// Shared switch row for the POS Settings tabs (Automation, Behavior, Devices…).
// Extracted from the original PrintingSettingsTab toggle so every settings
// section renders an identical, accessible switch. Label + optional helper
// description on the left, the switch on the right.
import type { JSX } from 'react';

export function SettingToggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-4 w-full py-3 border-b border-border-subtle text-left disabled:opacity-50 disabled:pointer-events-none"
    >
      <span className="min-w-0">
        <span className="block text-sm text-text-primary">{label}</span>
        {description && (
          <span className="block text-xs text-text-muted mt-0.5">{description}</span>
        )}
      </span>
      <span
        className={`shrink-0 h-6 w-11 rounded-full transition-colors ${checked ? 'bg-gold' : 'bg-bg-overlay'} relative`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}
