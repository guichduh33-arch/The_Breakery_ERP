// packages/ui/src/primitives/EmptyState.tsx
//
// EmptyState v2 — canonical empty-data placeholder.
//
// Session 14 D8 — "Empty states sont des écrans à part entière". Each empty
// state is a small composition, not a "No data" grey label:
//
//   ┌────────────────────────────────────┐
//   │           [icon or BrandMark]      │   ← 64-96px illustration
//   │                                    │
//   │            No transfers yet        │   ← Playfair italic title (display)
//   │  Create your first transfer to ... │   ← Inter body description
//   │                                    │
//   │           [ Add transfer →  ]      │   ← optional CTA
//   └────────────────────────────────────┘
//
// Backwards-compatible with session-13 API:
//  - `icon` accepts either a ReactNode (legacy) OR a Lucide icon component.
//    When it's a LucideIcon (function), it's rendered with theme sizing.
//  - `action` accepts either a ReactNode (legacy custom button) OR a plain
//    {label, onClick} object — the latter renders a primary CTA button.
//  - `title`/`description` unchanged.
//
// New props:
//  - `tone`        'default' | 'branded' — branded uses BrandMark when no icon.
//  - `size`        'sm' | 'md' | 'lg'    — controls vertical padding + icon.

import {
  createElement,
  isValidElement,
  type ComponentType,
  type JSX,
  type ReactNode,
  type SVGProps,
} from 'react';
import { cn } from '../lib/cn.js';
import { Button } from './Button.js';
import { BrandMark } from '../components/BrandMark.js';

type LucideLike = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export type EmptyStateAction =
  | ReactNode
  | { label: string; onClick: () => void };

export type EmptyStateSize = 'sm' | 'md' | 'lg';

export interface EmptyStateProps {
  /** Lucide icon component OR any ReactNode. If omitted and tone='branded', shows BrandMark. */
  icon?: ReactNode | LucideLike;
  /** Short headline, rendered in Playfair italic. */
  title: string;
  /** Optional explanatory paragraph, rendered in Inter body. */
  description?: string;
  /** Optional CTA — either a custom node or `{label, onClick}` for a primary button. */
  action?: EmptyStateAction;
  /** Size. Default 'md'. */
  size?: EmptyStateSize;
  /** Tone. 'branded' shows BrandMark when no icon. */
  tone?: 'default' | 'branded';
  className?: string;
  /** Test ID propagated to the outer element. */
  'data-testid'?: string;
}

const SIZE_PADDING: Record<EmptyStateSize, string> = {
  sm: 'py-8 px-6 gap-2',
  md: 'py-12 px-6 gap-3',
  lg: 'py-16 px-8 gap-4',
};

const ICON_PX: Record<EmptyStateSize, number> = {
  sm: 32,
  md: 48,
  lg: 64,
};

function isActionObject(
  a: EmptyStateAction,
): a is { label: string; onClick: () => void } {
  return (
    typeof a === 'object' &&
    a !== null &&
    !isValidElement(a) &&
    'label' in a &&
    'onClick' in a
  );
}

function renderIcon(
  icon: EmptyStateProps['icon'],
  size: EmptyStateSize,
): ReactNode {
  if (icon === undefined || icon === null) return null;
  // If it's a React element already (legacy callers passing <Foo /> or <svg/>),
  // render it directly.
  if (isValidElement(icon)) return icon;
  // Lucide icon components are forwardRef objects ({$$typeof, render}) OR
  // plain functions. Both should be instantiated as components.
  const isFunction = typeof icon === 'function';
  const isForwardRef =
    typeof icon === 'object' &&
    icon !== null &&
    'render' in icon &&
    typeof (icon as { render: unknown }).render === 'function';
  if (isFunction || isForwardRef) {
    const px = ICON_PX[size];
    return createElement(icon as LucideLike, { size: px, 'aria-hidden': 'true' });
  }
  // Otherwise it's any other ReactNode (string, fragment, etc.).
  return icon as ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  tone = 'default',
  className,
  'data-testid': testId,
}: EmptyStateProps): JSX.Element {
  const showBrandMark = tone === 'branded' && (icon === undefined || icon === null);
  const iconNode = renderIcon(icon, size);
  const brandSize = size === 'lg' ? 'xl' : size === 'sm' ? 'md' : 'lg';

  return (
    <div
      role="status"
      data-testid={testId}
      className={cn(
        'flex flex-col items-center justify-center text-center',
        SIZE_PADDING[size],
        className,
      )}
    >
      {showBrandMark && <BrandMark size={brandSize} />}
      {iconNode !== null && (
        <div aria-hidden="true" className="text-text-muted">
          {iconNode}
        </div>
      )}
      <h3
        className={cn(
          'font-display italic text-text-primary',
          size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-2xl' : 'text-xl',
        )}
      >
        {title}
      </h3>
      {description !== undefined && (
        <p className="max-w-prose text-sm text-text-secondary">{description}</p>
      )}
      {action !== undefined && (
        <div className="mt-2">
          {isActionObject(action) ? (
            <Button variant="gold" onClick={action.onClick}>
              {action.label}
            </Button>
          ) : (
            action
          )}
        </div>
      )}
    </div>
  );
}
