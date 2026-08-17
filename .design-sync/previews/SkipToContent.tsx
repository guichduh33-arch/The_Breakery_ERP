import { SkipToContent } from '@breakery/ui';

// Au repos le lien est sr-only (invisible). L'état FOCUS est simulé ici en
// neutralisant sr-only et en reproduisant les classes focus:* du composant —
// c'est l'apparence exacte du premier Tab clavier sur une page POS.
export const Focused = () => (
  <div className="flex flex-col items-start gap-3 bg-bg-base p-6">
    <SkipToContent className="not-sr-only static inline-block rounded-md bg-gold px-4 py-2 font-semibold text-gold-fg outline outline-2 outline-offset-2 outline-gold" />
    <p className="text-xs text-text-muted">
      État focus simulé — au repos, le lien est visuellement masqué (sr-only).
    </p>
  </div>
);

// Même état focus sous le thème ivoire du back-office.
export const Backoffice = () => (
  <div className="theme-backoffice flex flex-col items-start gap-3 bg-bg-base p-6">
    <SkipToContent
      href="#main-content"
      label="Aller au contenu principal"
      className="not-sr-only static inline-block rounded-md bg-gold px-4 py-2 font-semibold text-gold-fg outline outline-2 outline-offset-2 outline-gold"
    />
    <p className="text-xs text-text-muted">
      État focus simulé — libellé personnalisé via la prop label.
    </p>
  </div>
);
