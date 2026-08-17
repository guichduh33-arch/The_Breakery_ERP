import { CustomerSearchModal } from '@breakery/ui';
import { useEffect } from 'react';

// Le composant ne montre des résultats qu'après ≥ 2 caractères + debounce
// 300 ms : on rejoue une frappe native (« sa ») dans le champ pour que la
// capture montre la liste de résultats — searchFn répond des fixtures
// statiques quel que soit le terme.
function AutoQuery({ text }: { text: string }) {
  useEffect(() => {
    const t = setTimeout(() => {
      const input = document.querySelector('input[aria-label="Search customer"]') as HTMLInputElement | null;
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, 60);
    return () => clearTimeout(t);
  }, []);
  return null;
}

const customers = [
  {
    id: 'c1',
    name: 'Sari Dewi',
    phone: '+62 812-3456-7890',
    email: 'sari.dewi@gmail.com',
    customer_type: 'retail' as const,
    loyalty_points: 1250,
    lifetime_points: 8400,
    total_spent: 4200000,
    total_visits: 38,
    last_visit_at: '2026-08-15T09:12:00Z',
  },
  {
    id: 'c2',
    name: 'Samuel Wijaya',
    phone: '+62 813-9988-1122',
    email: null,
    customer_type: 'retail' as const,
    loyalty_points: 320,
    lifetime_points: 1900,
    total_spent: 950000,
    total_visits: 11,
    last_visit_at: '2026-08-10T15:40:00Z',
  },
  {
    id: 'c3',
    name: 'Salma Putri',
    phone: '+62 811-2233-4455',
    email: null,
    customer_type: 'retail' as const,
    loyalty_points: 0,
    lifetime_points: 0,
    total_spent: 64000,
    total_visits: 1,
    last_visit_at: '2026-08-16T08:05:00Z',
  },
];

// Rattacher un client à la commande — recherche « sa » avec 3 résultats,
// badges fidélité pour les clients à points.
export const Open = () => (
  <div className="fixed inset-0 bg-bg-base">
    <AutoQuery text="sa" />
    <CustomerSearchModal
      open
      onClose={() => {}}
      onSelect={() => {}}
      searchFn={async () => customers}
      createFn={async () => customers[0]}
    />
  </div>
);
