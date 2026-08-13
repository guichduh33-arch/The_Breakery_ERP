// packages/ui/src/primitives/FormField.tsx
//
// Critique /impeccable 2026-08-13 (P1, lot 2) — le câblage erreur→champ
// n'existait presque nulle part (6 aria-describedby pour 121 contrôles) parce
// qu'il était laissé à chaque call-site. Ce primitif le rend impossible à
// oublier : il porte le label (htmlFor), le marqueur requis (required sur le
// contrôle, astérisque hors du flux vocal), l'indice et l'erreur — et injecte
// id / required / aria-invalid / aria-describedby dans le contrôle enfant.
//
// Le contrôle enfant doit accepter ces props (Input, Select natifs, ou un
// composant qui les forwarde — cf. CategoryPicker). Un seul enfant par champ.

import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

interface InjectedControlProps {
  id?: string;
  required?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

export interface FormFieldProps {
  /** Id du contrôle — sert aussi de base aux ids d'indice (`-hint`) et d'erreur (`-error`). */
  id: string;
  label: ReactNode;
  /** Pose `required` sur le contrôle et rend l'astérisque (aria-hidden). */
  required?: boolean;
  /** Message d'erreur courant — null/undefined/'' = pas d'erreur. */
  error?: string | null;
  /** Indice permanent, rattaché au contrôle via aria-describedby. */
  hint?: ReactNode;
  children: ReactElement<InjectedControlProps>;
  className?: string;
  labelClassName?: string;
}

export function FormField({
  id,
  label,
  required = false,
  error,
  hint,
  children,
  className,
  labelClassName,
}: FormFieldProps): ReactElement {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hasError = error != null && error !== '';
  const describedBy = [
    children.props['aria-describedby'],
    hint != null ? hintId : null,
    hasError ? errorId : null,
  ].filter(Boolean).join(' ');

  const control = cloneElement(children, {
    id,
    required: required || children.props.required,
    'aria-invalid': hasError,
    'aria-describedby': describedBy === '' ? undefined : describedBy,
  });

  return (
    <div className={cn('space-y-1', className)}>
      <label
        htmlFor={id}
        className={cn('text-xs uppercase tracking-widest text-text-secondary', labelClassName)}
      >
        {label}
        {required && (
          <span className="text-red" aria-hidden="true">
            {' '}*
          </span>
        )}
      </label>
      {control}
      {hint != null && (
        <p id={hintId} className="text-xs text-text-secondary">
          {hint}
        </p>
      )}
      {hasError && (
        <p id={errorId} className="text-red text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
