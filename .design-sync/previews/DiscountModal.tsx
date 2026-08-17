import { DiscountModal } from '@breakery/ui';
import { useEffect } from 'react';

// Rejoue un clic sur le chip preset « Staff » (aria-label = nom du preset) :
// type % + valeur 10 + motif pré-rempli — l'état montré est donc valide, avec
// l'aperçu Subtotal / Discount / New total visible et Confirm actif.
function AutoPreset({ label }: { label: string }) {
  useEffect(() => {
    const t = setTimeout(() => {
      const btn = document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
      btn?.click();
    }, 80);
    return () => clearTimeout(t);
  }, []);
  return null;
}

// Remise manuelle sur une commande de Rp 128,000 — preset Staff 10 % appliqué,
// aperçu du nouveau total en direct.
export const Open = () => (
  <div className="fixed inset-0 bg-bg-base">
    <AutoPreset label="Staff" />
    <DiscountModal
      open
      base={128000}
      onClose={() => {}}
      onConfirm={() => {}}
      onRequireAuthorization={async () => 'manager-1'}
      presets={[
        { value: 10, name: 'Staff' },
        { value: 15, name: 'Habitué' },
        { value: 20, name: 'Manager' },
      ]}
    />
  </div>
);
