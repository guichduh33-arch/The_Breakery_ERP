# The Breakery — conventions d'usage du design system

## Mise en place

Aucun provider n'est requis. Le thème se choisit par une classe sur un conteneur racine :

- **Défaut (`:root`) = « luxe-dark »** — le thème sombre du POS. Pose le contenu sur `<div className="bg-bg-base text-text-primary font-body">`.
- **`.theme-backoffice`** — le thème ivoire du back-office : `<div className="theme-backoffice bg-bg-base text-text-primary font-body">`. Les mêmes tokens sont remappés ; aucun composant ne change d'API.

Sans fond `bg-bg-base` (ou un cran `bg-surface-*`), les composants sombres rendent sur du blanc : toujours poser le fond du thème d'abord.

## Idiome de style : utilitaires Tailwind du preset, jamais de couleurs brutes

Style tout via ces familles (elles existent dans la feuille expédiée ; une classe Tailwind hors vocabulaire usuel peut ne pas exister — reste dans ces familles pour tout ce qui est marque) :

| Famille | Classes réelles |
|---|---|
| Surfaces | `bg-bg-base` `bg-bg-elevated` `bg-bg-overlay` `bg-bg-input` · rampe `bg-surface-0`…`bg-surface-4`, `bg-surface-inert` |
| Encre (fonds sombres en thème clair) | `bg-ink` `bg-ink-hover` `bg-ink-raised` `text-ink-fg` `text-ink-fg-muted` `text-ink-gold` `border-ink-border` |
| Texte | `text-text-primary` `text-text-secondary` `text-text-muted` `text-text-subtle` `text-text-disabled` `text-text-inert` |
| Bordures | `border-border-subtle` `border-border-strong` `border-border-focus` `border-border-muted` `border-border-row` `border-border-gold` |
| Marque | `bg-gold` `bg-gold-hover` `bg-gold-soft` `text-gold` `text-gold-fg` · `bg-green` `text-green-fg` · `bg-red-soft` `text-red-as-text` `text-red-on-fill` |
| Sémantique (statuts) | `bg-success-soft text-success` · `bg-warning-soft text-warning` · `bg-danger-soft text-danger` · `bg-info-soft text-info` |
| Paiement | `bg-payment-cash` `bg-payment-card` `bg-payment-qris` `bg-payment-voucher` |
| Data-viz | `text-chart-1`…`chart-4` · identité catégorie : `bg-cat-amber` `bg-cat-blue` … (12 teintes) |
| Polices | `font-body` (Inter) · `font-display`/`font-serif` (Playfair Display — titres) · `font-mono`/`font-data` (JetBrains Mono — montants, SKU, KPI) |
| Échelle typo | `text-xs`…`text-3xl`, `text-display` (56px héro) · tracking `tracking-widest` (signature SectionLabel) |
| Rayons/ombres | `rounded-sm`…`rounded-2xl` · `shadow-xs`…`shadow-xl`, `shadow-modal`, `shadow-hairline` |
| Espacement tactile | `h-touch-min` (44px) `h-touch-comfy` `h-touch-large` · gouttières `p-gutter-card` `gap-gutter-compact` |
| Motion | `duration-fast/base/slow` + `ease-motion-out/in` |

**Pièges** : pas de modificateur d'alpha sur ces tokens (`bg-danger/15` produit ZÉRO style — seule la famille `cat-*` accepte `/alpha`, et seulement pour les valeurs déjà compilées). Montants toujours en `font-mono tabular-nums` au format `Rp 36,000`.

## Où vit la vérité

- `styles.css` → importe `_ds_bundle.css` (utilitaires compilés + les ~237 variables CSS des deux thèmes) et `fonts/fonts.css`. Lis `_ds_bundle.css` pour vérifier qu'une classe existe.
- Chaque composant : `components/<groupe>/<Nom>/<Nom>.d.ts` (l'API) et `<Nom>.prompt.md` (usage + exemples).

## Exemple idiomatique

```jsx
const { Card, CardHeader, CardTitle, CardDescription, CardContent, Badge, Button } = window.BreakeryUI;

<div className="bg-bg-base p-6 font-body">
  <Card className="max-w-sm">
    <CardHeader>
      <div className="flex items-center justify-between">
        <CardTitle>Commande #1042</CardTitle>
        <Badge variant="success">Payée</Badge>
      </div>
      <CardDescription>Sur place — Table 4 · 14:32</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="flex justify-between text-sm text-text-secondary">
        <span>2 × Croissant beurre</span>
        <span className="font-mono tabular-nums">Rp 36,000</span>
      </div>
    </CardContent>
  </Card>
</div>
```
