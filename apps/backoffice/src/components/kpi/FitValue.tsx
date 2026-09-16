import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { cn } from '@breakery/ui';

interface FitValueProps extends ComponentPropsWithoutRef<'span'> {
  value: string;
  exact?: string;
}

/** Choisit uniquement la présentation : le montant exact et le compact sont
 * fournis par les formatteurs existants, sans recalcul ni arrondi local. */
export function FitValue({ value, exact, className, ...props }: FitValueProps) {
  const box = useRef<HTMLSpanElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(false);
  useEffect(() => {
    const container = box.current;
    const text = measure.current;
    if (!container || !text || typeof ResizeObserver === 'undefined') return;
    let active = true;
    const update = () => {
      if (active) setFits(container.clientWidth > 0 && text.getBoundingClientRect().width <= container.clientWidth);
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    update();
    void document.fonts?.ready.then(update);
    return () => { active = false; observer.disconnect(); };
  }, [exact, value]);

  return (
    <span ref={box} className={cn('relative block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap', className)} title={exact ?? value} {...props}>
      <span className={className} aria-hidden={exact !== undefined ? true : undefined}>{exact !== undefined && fits ? exact : value}</span>
      {exact !== undefined && <>
        <span className="sr-only">{exact}</span>
        <span ref={measure} className="invisible absolute left-0 top-0 whitespace-nowrap" aria-hidden>{exact}</span>
      </>}
    </span>
  );
}
