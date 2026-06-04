import { memo, useState, type JSX } from 'react';
import { cn } from '../lib/cn.js';

export interface QwertyLayoutProps {
  onKey: (char: string) => void;
  onBackspace: () => void;
  onSpace: () => void;
  onDone: () => void;
  className?: string;
}

const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

function QwertyLayoutInner({
  onKey,
  onBackspace,
  onSpace,
  onDone,
  className,
}: QwertyLayoutProps): JSX.Element {
  const [shift, setShift] = useState(false);
  const press = (c: string): void => {
    onKey(shift ? c.toUpperCase() : c);
    if (shift) setShift(false);
  };
  const keyCls =
    'h-touch-comfy min-w-[2.25rem] flex-1 rounded-md bg-bg-input border border-border-subtle text-text-primary text-lg font-medium active:scale-95 transition-transform';
  const actCls =
    'h-touch-comfy rounded-md bg-bg-overlay border border-border-subtle text-text-secondary text-sm active:scale-95';
  return (
    <div className={cn('space-y-2 select-none', className)}>
      {ROWS.map((row, ri) => (
        <div key={ri} className="flex gap-1.5 justify-center">
          {ri === 2 && (
            <button
              type="button"
              aria-label="Shift"
              onClick={() => setShift((s) => !s)}
              className={cn(actCls, 'px-3', shift && 'border-gold text-gold')}
            >
              ⇧
            </button>
          )}
          {row.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => press(c)}
              className={keyCls}
            >
              {shift ? c.toUpperCase() : c}
            </button>
          ))}
          {ri === 2 && (
            <button
              type="button"
              aria-label="Backspace"
              onClick={onBackspace}
              className={cn(actCls, 'px-3')}
            >
              ⌫
            </button>
          )}
        </div>
      ))}
      <div className="flex gap-1.5">
        <button
          type="button"
          aria-label="Space"
          onClick={onSpace}
          className={cn(keyCls, 'flex-[6]')}
        >
          space
        </button>
        <button
          type="button"
          aria-label="Done"
          onClick={onDone}
          className="h-touch-comfy rounded-md bg-gold text-black font-semibold px-6 active:scale-95"
        >
          Done
        </button>
      </div>
    </div>
  );
}

export const QwertyLayout = memo(QwertyLayoutInner);
