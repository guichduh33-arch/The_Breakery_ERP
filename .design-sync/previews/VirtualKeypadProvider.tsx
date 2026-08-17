import { Input, VirtualKeypadProvider, useVirtualKeypad } from '@breakery/ui';
import { useEffect, useRef } from 'react';

// Le provider ne rend rien par lui-même : on ouvre l'overlay via le hook
// public useVirtualKeypad (openFor) sur un input data-vkp monté, comme le
// ferait un focusin réel sur tablette.
const AutoOpenInput = ({
  layout,
  label,
  defaultValue,
  placeholder,
}: {
  layout: 'numeric' | 'qwerty';
  label: string;
  defaultValue?: string;
  placeholder?: string;
}) => {
  const { openFor } = useVirtualKeypad();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) openFor(ref.current, layout);
  }, [openFor, layout]);
  return (
    <label className="block space-y-1.5">
      <span className="text-xs uppercase tracking-widest text-text-secondary">{label}</span>
      <Input
        ref={ref}
        data-vkp={layout}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="font-mono tabular-nums"
      />
    </label>
  );
};

// Overlay numérique ouvert sous un champ montant (fixed bottom, style tablette).
export const NumpadOuvert = () => (
  <VirtualKeypadProvider>
    <div className="bg-bg-base p-6 pb-[32rem]">
      <div className="mx-auto max-w-sm">
        <AutoOpenInput layout="numeric" label="Montant reçu" defaultValue="100000" />
      </div>
    </div>
  </VirtualKeypadProvider>
);

// Overlay QWERTY ouvert sous un champ texte (nom client tablette).
export const QwertyOuvert = () => (
  <VirtualKeypadProvider>
    <div className="bg-bg-base p-6 pb-[20rem]">
      <div className="mx-auto max-w-sm">
        <AutoOpenInput layout="qwerty" label="Nom du client" defaultValue="Ibu Sari" />
      </div>
    </div>
  </VirtualKeypadProvider>
);
