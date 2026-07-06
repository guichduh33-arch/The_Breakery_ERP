# Snippet référence — tokens OKLCH + typo tabulaire POS

> **Les valeurs ci-dessous illustrent la palette actuelle (charcoal/gold) — ce n'est PAS la seule direction permise.** Le skill propose des palettes alternatives (terracotta/crème, sauge/miel, solaire haute-luminance…) construites avec la même mécanique OKLCH : mêmes rapports de L entre surfaces, même dérivation d'états, contrastes mesurés au navigateur (protocole Playwright du SKILL.md).

> Prêt à adapter, pas à coller aveuglément : les valeurs L/C/H ci-dessous sont des points de départ calés sur l'identité luxe-dark (charcoal + gold). Toujours vérifier le contraste réel (AAA 7:1 sur chiffres) après ajustement. Les tokens neufs s'insèrent dans la cascade `packages/ui/src/tokens/` (couche `colors.css` — c'est l'arbre importé via `@breakery/ui/tokens.css`), pas dans un composant.

## Vérifier un ratio WCAG depuis des valeurs OKLCH

Le ratio WCAG se calcule en luminance sRGB — convertir d'abord. Méthode reproductible sans dépendance à installer :

```bash
node -e "
// conversion oklch->srgb approx via culori si dispo, sinon :
// coller les deux couleurs dans un convertisseur (oklch.com) -> hex,
// puis ratio = (L1+0.05)/(L2+0.05) avec L = luminance relative WCAG.
"
npx -y culori-cli 2>/dev/null || echo 'fallback: convertir sur oklch.com puis vérifier le ratio hex↔hex (webaim contrast checker)'
```

En pratique : convertir les deux OKLCH en hex (outil `oklch.com` ou lib `culori` en devDep temporaire), vérifier le couple hex au standard WCAG (≥ 7:1 chiffres, ≥ 4.5:1 texte). Ne jamais affirmer un ratio sans l'avoir calculé.

## Pourquoi OKLCH

- **Perceptuellement uniforme** : +0.05 de L = même éclaircissement perçu quelle que soit la teinte → états `hover`/`pressed`/`disabled` dérivés mécaniquement, cohérents sur toute la palette.
- **Gamut P3** disponible sur les tablettes récentes, dégradation propre en sRGB.
- Supporté par tous les navigateurs cibles (Chrome/Safari/Edge 2023+) — utilisable **dès aujourd'hui en Tailwind v3** via custom props.

## Forme 1 — Tailwind v3 (état actuel du repo) : custom props CSS

```css
/* packages/ui/src/tokens/colors.css — extension POS, couche :root (luxe-dark) */
:root {
  /* Surfaces charcoal — L croît avec l'élévation */
  --pos-surface-0: oklch(0.18 0.01 60);   /* fond app */
  --pos-surface-1: oklch(0.22 0.012 60);  /* grille */
  --pos-surface-2: oklch(0.26 0.014 60);  /* carte produit */
  --pos-surface-3: oklch(0.30 0.016 60);  /* overlay/modale */

  /* Gold marque — parcimonieux : action primaire + accents */
  --pos-gold: oklch(0.75 0.12 85);
  --pos-gold-pressed: oklch(0.68 0.12 85);   /* L −0.07 = pressed net */
  --pos-gold-fg: oklch(0.20 0.02 85);        /* texte sur gold, AAA */

  /* Chiffres plein soleil — contraste max sur surface-0 */
  --pos-numeral: oklch(0.97 0.005 85);       /* ~15:1 sur surface-0 */

  /* Sémantique KDS (code d'attente, pas déco) */
  --pos-wait-ok: oklch(0.72 0.17 145);
  --pos-wait-warn: oklch(0.78 0.16 80);
  --pos-wait-late: oklch(0.62 0.21 25);
}
```

Exposition Tailwind v3 (`tailwind.config` de l'app) :

```js
colors: {
  'pos-gold': 'var(--pos-gold)',
  'pos-surface': {
    0: 'var(--pos-surface-0)', 1: 'var(--pos-surface-1)',
    2: 'var(--pos-surface-2)', 3: 'var(--pos-surface-3)',
  },
},
```

## Forme 2 — Tailwind v4 (cible, SEULEMENT si package.json ≥ 4)

```css
@theme {
  --color-pos-surface-0: oklch(0.18 0.01 60);
  --color-pos-surface-1: oklch(0.22 0.012 60);
  --color-pos-gold: oklch(0.75 0.12 85);
  --color-pos-gold-pressed: oklch(0.68 0.12 85);
  --color-pos-numeral: oklch(0.97 0.005 85);
}
/* Utilitaires générés automatiquement : bg-pos-surface-0, text-pos-numeral, size-14… */
```

## Typo tabulaire (obligatoire prix/totaux/quantités/timers)

```css
/* packages/ui/src/tokens/typography.css — utilitaire dédié */
.numeric {
  font-variant-numeric: tabular-nums lining-nums;
  font-feature-settings: 'tnum' 1, 'lnum' 1; /* fallback anciens moteurs */
  letter-spacing: 0.01em;
}
```

```tsx
// Usage — le total ne « danse » jamais quand les chiffres changent
<span className="numeric text-4xl font-semibold">{formatIDR(total)}</span>
```

Note fonts du repo (vérifié 2026-07-06) : Inter Variable et JetBrains Mono supportent `tnum` ; **JetBrains Mono est déjà mono** (tabulaire par nature) — bon choix pour les colonnes de ticket. Fraunces/Playfair = marque uniquement, jamais pour des chiffres opérationnels.

## Rappel dérivation d'états (règle mécanique)

| État | Transformation OKLCH |
|------|---------------------|
| hover | L +0.04 (dark) / −0.04 (light) |
| pressed | L −0.07 (feedback net, visible en plein soleil) |
| disabled | C ×0.3, alpha 0.5 |
| focus ring | même H, L 0.80, C +0.02, ring 2 px |
