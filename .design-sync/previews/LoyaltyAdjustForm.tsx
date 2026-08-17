import { Card, CardContent, CardHeader, CardTitle, LoyaltyAdjustForm } from '@breakery/ui';
import { useEffect, useRef, type ReactNode } from 'react';

// L'état du formulaire est interne (pas d'initialValues) : pour montrer un
// formulaire rempli, on rejoue une saisie réelle via les setters natifs +
// events `input`/`click` que React écoute. Scopé par ref à la cellule.
const Script = ({
  amount,
  reason,
  subtract,
  children,
}: {
  amount?: string;
  reason?: string;
  subtract?: boolean;
  children: ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (root === null) return;
    const fire = (el: Element | null, proto: { prototype: object }, value: string): void => {
      if (el === null) return;
      const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    if (subtract === true) {
      const radios = root.querySelectorAll<HTMLInputElement>('input[type="radio"]');
      radios[1]?.click();
    }
    if (amount !== undefined) fire(root.querySelector('input[type="number"]'), HTMLInputElement, amount);
    if (reason !== undefined) fire(root.querySelector('textarea'), HTMLTextAreaElement, reason);
  }, [amount, reason, subtract]);
  return <div ref={ref}>{children}</div>;
};

// Ajustement rempli : +2 500 pts, motif d'audit, solde projeté affiché.
export const Backoffice = () => (
  <div className="theme-backoffice bg-bg-base p-6">
    <Script amount="2500" reason="Geste commercial — anniversaire cliente fidèle (Ibu Sari)">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Ajuster les points — Ibu Sari</CardTitle>
        </CardHeader>
        <CardContent>
          <LoyaltyAdjustForm currentBalance={12500} onSubmit={() => {}} onCancel={() => {}} />
        </CardContent>
      </Card>
    </Script>
  </div>
);

// État au repos — champs vides, bouton Apply désactivé.
export const Resting = () => (
  <div className="theme-backoffice bg-bg-base p-6">
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Ajuster les points — Pak Budi</CardTitle>
      </CardHeader>
      <CardContent>
        <LoyaltyAdjustForm currentBalance={860} onSubmit={() => {}} onCancel={() => {}} />
      </CardContent>
    </Card>
  </div>
);

// Erreur : retrait supérieur au solde → « Customer only has 12.500 points. »,
// Apply reste désactivé.
export const InsufficientBalance = () => (
  <div className="theme-backoffice bg-bg-base p-6">
    <Script subtract amount="20000" reason="Correction de double comptage du 12/08">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Ajuster les points — Ibu Sari</CardTitle>
        </CardHeader>
        <CardContent>
          <LoyaltyAdjustForm currentBalance={12500} onSubmit={() => {}} onCancel={() => {}} />
        </CardContent>
      </Card>
    </Script>
  </div>
);
