import { QwertyLayout } from '@breakery/ui';

// Clavier tactile complet — 3 rangées, shift, backspace, espace, Done gold.
export const Clavier = () => (
  <div className="bg-bg-base p-6">
    <QwertyLayout
      onKey={() => {}}
      onBackspace={() => {}}
      onSpace={() => {}}
      onDone={() => {}}
      className="mx-auto max-w-lg"
    />
  </div>
);

// En contexte : barre basse du VirtualKeypadProvider (nom client en saisie).
export const EnOverlay = () => (
  <div className="bg-bg-base p-6">
    <div className="mx-auto max-w-lg rounded-lg border border-border-subtle bg-bg-elevated p-4 shadow-modal">
      <p className="mb-3 text-center text-sm text-text-secondary">
        Client : <span className="text-text-primary">Ibu Sari</span>
      </p>
      <QwertyLayout onKey={() => {}} onBackspace={() => {}} onSpace={() => {}} onDone={() => {}} />
    </div>
  </div>
);
