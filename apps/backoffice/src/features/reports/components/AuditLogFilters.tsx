// apps/backoffice/src/features/reports/components/AuditLogFilters.tsx
//
// Barre de filtres du journal d'audit — acteur / action / type d'entité. Elle
// câble des filtres que `get_audit_logs_v3` acceptait sans que l'écran ne les
// expose. Les options d'acteur viennent de `useLoginUsers` (list_login_users_v1),
// un listing minimal id/display_name/role déjà en place : aucune RPC ni aucun
// grant neuf pour peupler ce `<select>`.
//
// Lot G (campagne Reports 2026-08-15) — deux changements :
//
//  · LES BORNES DE DATE SORTENT D'ICI. Elles vivent désormais dans le contrôle
//    de période du bandeau (`PeriodControl`, params `start`/`end`), comme sur
//    les trente autres rapports. Garder un second couple « From / To » dans la
//    barre de filtres aurait posé DEUX contrôles de date sur le même écran, sans
//    dire lequel gagne.
//  · Les champs passent sur les primitifs `Input` / `selectClassName` de
//    @breakery/ui (inventaire n° 11) : c'étaient les derniers `<input>` et
//    `<select>` nus du module, avec leur propre hauteur et leur propre anneau de
//    focus. Format de bandeau : 32 px, à la hauteur des boutons d'action.
//
// Le débounce et la forme fonctionnelle des commits restent — voir plus bas :
// ils corrigent deux bugs distincts, et aucun des deux n'est cosmétique.

import { useEffect, useRef, useState, type Dispatch, type JSX, type SetStateAction } from 'react';
import { Input, cn, selectClassName } from '@breakery/ui';
import { useLoginUsers } from '@/features/auth/hooks/useLoginUsers.js';

export interface AuditLogFilterValues {
  actorId:    string;
  action:     string;
  entityType: string;
}

export const EMPTY_AUDIT_LOG_FILTERS: AuditLogFilterValues = {
  actorId: '', action: '', entityType: '',
};

export interface AuditLogFiltersProps {
  value: AuditLogFilterValues;
  // Forme « updater fonctionnel » (celle du setter de useState, que AuditPage
  // passe directement). Obligatoire — voir le commentaire sur la fermeture
  // périmée que la signature `(next) => void` provoquait.
  onChange: Dispatch<SetStateAction<AuditLogFilterValues>>;
}

// Valeurs d'`entity_type` écrites par les RPC d'audit du dépôt — un indice de
// <datalist>, pas un enum exhaustif (`entity_type` est du texte libre serveur).
const ENTITY_TYPE_HINTS = [
  'product', 'category', 'variant', 'order', 'expense', 'customer', 'user',
  'supplier', 'purchase_order', 'promotion', 'combo', 'account', 'recipe',
];

// Constat de revue (S59 Task 6c) — les deux champs libres (Action, Entity type)
// émettaient `onChange` à chaque frappe, ce qui entre dans la queryKey de
// useAuditLogs et relance la RPC par CARACTÈRE. Pas de hook useDebounce partagé
// dans ce dépôt : on reprend l'idiome setTimeout + ref utilisé ailleurs.
const DEBOUNCE_MS = 300;

// Constat de re-revue — la première version du débounce fermait sur `value`
// (et sur le brouillon voisin) AU MOMENT DE LA FRAPPE. Changer l'acteur (commit
// immédiat) pendant qu'un timer Action/Entity était en vol faisait revenir
// l'acteur périmé 300 ms plus tard, annulant en silence le choix qu'on venait
// de faire. Correctif : chaque commit passe par l'updater fonctionnel
// (`(prev) => ...`), donc React fusionne toujours dans l'état le plus frais.

const FIELD = 'h-8 w-40';
const FIELD_LABEL = 'flex items-center gap-2 text-sm text-text-secondary';

export function AuditLogFilters({ value, onChange }: AuditLogFiltersProps): JSX.Element {
  const users = useLoginUsers();
  const hasFilters = value.actorId !== '' || value.action !== '' || value.entityType !== '';

  // Brouillons locaux : le champ suit chaque frappe pendant que le commit vers
  // le parent (→ re-fetch RPC) est débouncé. L'acteur reste un `<select>` — un
  // choix discret, pas un flux de frappe — donc commit immédiat, sans brouillon.
  const [actionDraft, setActionDraft] = useState(value.action);
  const [entityDraft, setEntityDraft] = useState(value.entityType);
  const actionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resynchronise les brouillons quand `value` change de L'EXTÉRIEUR (« Clear
  // filters », ou tout autre reset) — pas sur notre propre écho débouncé.
  useEffect(() => {
    setActionDraft(value.action);
    setEntityDraft(value.entityType);
  }, [value.action, value.entityType]);

  useEffect(() => {
    return () => {
      if (actionTimer.current) clearTimeout(actionTimer.current);
      if (entityTimer.current) clearTimeout(entityTimer.current);
    };
  }, []);

  function handleActionChange(next: string): void {
    setActionDraft(next);
    if (actionTimer.current) clearTimeout(actionTimer.current);
    actionTimer.current = setTimeout(() => {
      onChange((prev) => ({ ...prev, action: next }));
    }, DEBOUNCE_MS);
  }

  function handleEntityChange(next: string): void {
    setEntityDraft(next);
    if (entityTimer.current) clearTimeout(entityTimer.current);
    entityTimer.current = setTimeout(() => {
      onChange((prev) => ({ ...prev, entityType: next }));
    }, DEBOUNCE_MS);
  }

  function handleClear(): void {
    if (actionTimer.current) clearTimeout(actionTimer.current);
    if (entityTimer.current) clearTimeout(entityTimer.current);
    setActionDraft('');
    setEntityDraft('');
    onChange(EMPTY_AUDIT_LOG_FILTERS);
  }

  return (
    <>
      <label className={FIELD_LABEL}>
        <span className="sr-only">Actor</span>
        <select
          value={value.actorId}
          onChange={(e) => { onChange((prev) => ({ ...prev, actorId: e.target.value })); }}
          className={cn(selectClassName, FIELD)}
          data-testid="audit-filter-actor"
          aria-label="Filter by actor"
        >
          <option value="">All actors</option>
          {(users.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>{u.display_name}</option>
          ))}
        </select>
      </label>

      <label className={FIELD_LABEL}>
        <span className="sr-only">Action</span>
        <Input
          type="text"
          value={actionDraft}
          onChange={(e) => { handleActionChange(e.target.value); }}
          placeholder="Action, e.g. product.update"
          className={FIELD}
          data-testid="audit-filter-action"
          aria-label="Filter by action"
        />
      </label>

      <label className={FIELD_LABEL}>
        <span className="sr-only">Entity type</span>
        <Input
          list="audit-entity-type-hints"
          value={entityDraft}
          onChange={(e) => { handleEntityChange(e.target.value); }}
          placeholder="Entity, e.g. product"
          className={FIELD}
          data-testid="audit-filter-entity"
          aria-label="Filter by entity type"
        />
        <datalist id="audit-entity-type-hints">
          {ENTITY_TYPE_HINTS.map((t) => <option key={t} value={t} />)}
        </datalist>
      </label>

      {hasFilters && (
        <button
          type="button"
          onClick={handleClear}
          className="h-8 rounded-sm px-2 text-xs text-text-secondary hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          data-testid="audit-filter-clear"
        >
          Clear filters
        </button>
      )}
    </>
  );
}
