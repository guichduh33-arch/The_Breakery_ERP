// apps/backoffice/src/components/FormField.tsx
//
// Le champ de formulaire du back-office — le primitif partagé, plus la famille
// de son libellé.
//
// Le `FormField` de `@breakery/ui` écrit son libellé en `text-xs uppercase
// tracking-widest` sans famille de police : capitales interlettrées, donc le
// rôle Label de DESIGN.md — et ce rôle rend en JetBrains Mono, 600. Mesuré le
// 2026-09-04 sur « New expense » : treize libellés en Instrument Sans sur un
// écran où chaque en-tête de colonne du produit est en mono. Le primitif est
// partagé avec la caisse et ne se retouche pas ici ; la famille se pose dans ce
// wrapper via `labelClassName`, et chaque appelant du back-office l'importe
// d'ici. Même geste que `components/SectionLabel.tsx`.

import type { ReactElement } from 'react';
import { FormField as UiFormField, type FormFieldProps } from '@breakery/ui';
import { cn } from '@breakery/ui';

export type { FormFieldProps };

export function FormField({ labelClassName, ...props }: FormFieldProps): ReactElement {
  return <UiFormField {...props} labelClassName={cn('font-data font-semibold', labelClassName)} />;
}
