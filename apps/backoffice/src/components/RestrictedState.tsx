// apps/backoffice/src/components/RestrictedState.tsx
//
// LE BLOC « RESTRICTED » — une seule définition pour tout le back-office.
//
// DESIGN.md § Do's l'exige en toutes lettres : « faire dégrader une page carte
// par carte quand une permission manque, en disant "restricted" plutôt qu'en
// affichant une erreur rouge ». Le patron existait déjà, mais à UN seul
// endroit — `pages/Dashboard.tsx` — pendant que cinq autres écrans rendaient
// une ligne de texte gris nue. Ce fichier extrait ce bloc ; le Dashboard en est
// désormais le premier appelant, pas un cas particulier.
//
// Pourquoi il ne réutilise NI `ErrorState` NI `EmptyState` :
//  · `ErrorState` (et `QueryErrorBanner`) porte `role="alert"`, une icône
//    d'avertissement et l'encre rouge. Un droit manquant n'est pas une panne :
//    rien n'a échoué, l'écran fait exactement ce qu'on lui a demandé. Peindre
//    ça en rouge envoie l'opérateur réessayer, ou appeler la maintenance.
//  · `EmptyState` (@breakery/ui) dit « il n'y a rien ici » et le dit en
//    Playfair italique, centré — or DESIGN.md § Don't réserve Playfair au
//    monogramme de marque, et le message est faux : il y a quelque chose, c'est
//    l'utilisateur qui n'y a pas droit.
//
// LA SECONDE LIGNE EST LA RAISON D'ÊTRE DU COMPOSANT. Un « restricted » qui ne
// nomme pas le droit manquant laisse l'utilisateur sans recours : il sait qu'il
// est dehors, pas quoi demander ni à qui. Nommer l'exigence est donc
// OBLIGATOIRE — le typage n'offre aucune forme sans elle. Un code de permission
// se rend en `font-data` : c'est un identifiant machine, à recopier tel quel
// dans une demande, au même titre que le détail serveur de `QueryErrorBanner`.
//
// `role="status"` et non `role="alert"` : l'information est vraie et stable,
// elle n'interrompt rien. (Le test du Dashboard vérifie d'ailleurs qu'aucun
// `role="alert"` ne subsiste dans cet état.)

// EXTENSION LOT 9 — LE MÊME BLOC POUR UN GARDE DE RÔLE.
//
// `AdminGate` (routes/index.tsx) éjectait encore vers /backoffice avec un
// toast, exactement ce que le lot 4 a défait sur `PermissionGate` : deux
// traitements du même refus dans le même produit. L'objection qui l'avait
// laissé de côté — « un garde de rôle n'a aucun code de permission à nommer » —
// se règle en nommant ce qu'il exige VRAIMENT : le rôle. C'est au moins aussi
// utile à l'opérateur, et ça lui dit à qui s'adresser.
//
// Deux différences de FOND avec la variante permission, pas de simples mots :
//   · les permissions sont exigées CONJOINTEMENT (« … and … »), les rôles sont
//     ALTERNATIFS (« … or … ») — un seul suffit, et la phrase reste au
//     singulier même quand la liste en propose deux ;
//   · un code de rôle brut ne se montre pas. `SUPER_ADMIN` est un identifiant
//     de base ; l'écran des utilisateurs, lui, écrit « Super admin » —
//     c'est ce libellé-là que l'opérateur doit citer. Le code de permission
//     reste, lui, en `font-data` : il n'a pas de nom humain, c'est l'identifiant
//     qu'on recopie tel quel dans une demande.
//
// Les deux formes sont MUTUELLEMENT EXCLUSIVES par le typage (`never` croisé) :
// un appelant ne peut ni passer les deux, ni n'en passer aucune.

import type { JSX } from 'react';
import { Lock } from 'lucide-react';
import { Card, cn } from '@breakery/ui';
import type { PermissionCode } from '@breakery/supabase';
import { roleLabel, type RoleCode } from '@/lib/roleLabels.js';

interface RestrictedStateBaseProps {
  /**
   * Ce que l'écran ne montre pas, en SUJET de phrase : « Dashboard metrics »,
   * « This purchase order », « Production ». Rendu dans « Access to … is
   * restricted. » — tournure volontairement insensible au nombre, pour qu'un
   * sujet pluriel n'oblige pas l'appelant à réécrire la phrase.
   */
  what: string;
  /** Classes sur la carte (ex. `shadow-none` sur un dashboard). */
  className?: string;
  /** Propagé sur la carte — le Dashboard s'appuie dessus (`dashboard-restricted`). */
  'data-testid'?: string;
}

export type RestrictedStateProps = RestrictedStateBaseProps &
  (
    | {
        /** Le ou les codes qui débloquent. Exigés CONJOINTEMENT quand il y en a plusieurs. */
        permission: PermissionCode | readonly PermissionCode[];
        role?: never;
      }
    | {
        /** Le ou les rôles qui débloquent. ALTERNATIFS — un seul suffit. */
        role: RoleCode | readonly RoleCode[];
        permission?: never;
      }
  );

export function RestrictedState(props: RestrictedStateProps): JSX.Element {
  const { what, className, 'data-testid': testId } = props;

  return (
    <Card
      variant="default"
      padding="md"
      role="status"
      data-testid={testId}
      className={cn('shadow-none', className)}
    >
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-text-muted" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm text-text-primary">Access to {what} is restricted.</p>
          {props.permission !== undefined ? (
            <RequiredPermissions permission={props.permission} />
          ) : (
            <RequiredRoles role={props.role} />
          )}
        </div>
      </div>
    </Card>
  );
}

/** « It requires the a and b permissions. » — exigence CONJOINTE. */
function RequiredPermissions({
  permission,
}: {
  permission: PermissionCode | readonly PermissionCode[];
}): JSX.Element {
  // `PermissionCode` est une union de littéraux : `typeof` narrow proprement,
  // là où `Array.isArray` sur un `readonly T[]` retombe sur `any[]`.
  const codes: readonly PermissionCode[] =
    typeof permission === 'string' ? [permission] : permission;

  return (
    <p className="mt-0.5 text-xs text-text-muted">
      {'It requires the '}
      {codes.map((code, i) => (
        <span key={code}>
          {i > 0 && ' and '}
          <span className="font-data">{code}</span>
        </span>
      ))}
      {codes.length === 1
        ? ' permission. Ask an administrator to grant it.'
        : ' permissions. Ask an administrator to grant them.'}
    </p>
  );
}

/**
 * « It requires the Admin or Super admin role. » — exigence ALTERNATIVE, donc
 * « or » et un singulier qui tient même à plusieurs entrées : l'opérateur n'a
 * jamais besoin des deux, il en demande un.
 */
function RequiredRoles({ role }: { role: RoleCode | readonly RoleCode[] }): JSX.Element {
  const roles: readonly RoleCode[] = typeof role === 'string' ? [role] : role;

  return (
    <p className="mt-0.5 text-xs text-text-muted">
      {'It requires the '}
      {roles.map((code, i) => (
        <span key={code}>
          {i > 0 && ' or '}
          <span className="text-text-secondary">{roleLabel(code)}</span>
        </span>
      ))}
      {' role. Ask an administrator to grant it.'}
    </p>
  );
}
