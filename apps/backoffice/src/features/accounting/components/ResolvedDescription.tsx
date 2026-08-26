// apps/backoffice/src/features/accounting/components/ResolvedDescription.tsx
//
// Rendu d'une description d'écriture avec ses identifiants substitués par des
// noms (voir `utils/journalDescription.ts` pour la doctrine : la colonne
// stockée ne bouge pas, la substitution vit au rendu, l'UUID reste à un survol
// de distance). Extrait de `JournalEntriesPage` quand le tiroir de détail a eu
// besoin du même rendu (critique design 2026-08-26 : la liste humanisait
// « session 26 Aug » et le tiroir, ouvert depuis la même ligne, rendait
// « session 4d11cb01-… ») — deux copies de ce markup auraient divergé.

import { Fragment, type JSX } from 'react';
import { segmentDescription } from '../utils/journalDescription.js';

export interface ResolvedDescriptionProps {
  text: string;
  names: ReadonlyMap<string, string>;
}

export function ResolvedDescription({ text, names }: ResolvedDescriptionProps): JSX.Element {
  return (
    <>
      {segmentDescription(text, names).map((seg) =>
        seg.uuid === null ? (
          <Fragment key={seg.key}>{seg.text}</Fragment>
        ) : (
          // Le nom REMPLACE l'identifiant, il ne l'efface pas : le pointillé
          // signale la substitution et le `title` rend l'original — un
          // comptable qui rapproche une ligne avec un export en a besoin.
          <span
            key={seg.key}
            title={seg.uuid}
            className="border-b border-dotted border-border-strong"
          >
            {seg.text}
          </span>
        ),
      )}
    </>
  );
}
