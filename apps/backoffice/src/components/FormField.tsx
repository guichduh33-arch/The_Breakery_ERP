// Libellés de formulaire Instrument Sans propres au back-office.
// Le primitif conserve les identifiants, erreurs, validations et associations accessibles.

import type { ReactElement } from 'react';
import { FormField as UiFormField, type FormFieldProps } from '@breakery/ui';
import { cn } from '@breakery/ui';

export type { FormFieldProps };

export function FormField({ labelClassName, ...props }: FormFieldProps): ReactElement {
  return <UiFormField {...props} labelClassName={cn('font-body text-sm font-medium normal-case tracking-normal', labelClassName)} />;
}
