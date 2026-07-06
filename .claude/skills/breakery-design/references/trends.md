# Digest trends UI — filtré pour The Breakery ERP

> **Daté : 2026-07-06** (sources web du jour — cf. bas de page). Protocole refresh dans `SKILL.md` : si ce fichier a > ~6 mois lors d'une décision esthétique structurante, re-vérifier par WebSearch et mettre à jour la date.

Chaque trend reçoit un verdict : ✅ **applicable** · ⚖️ **à doser** · ❌ **gadget à éviter ici**.

## ✅ Applicables

| Trend | Application Breakery |
|-------|---------------------|
| **Clarity-first dashboards** (réduire le bruit, surfacer l'essentiel, guider l'action) | Direction déjà prise avec le Dashboard S63 : 5 KPIs + drill-down. Toute nouvelle page report suit ce modèle — un message principal par écran. |
| **Progressive disclosure** (complexité révélée au besoin) | Tablet self-service (modifiers au tap), formulaires BO multi-step (Dialog stepper existant), filtres avancés repliés par défaut. |
| **Bento grids** (blocs modulaires de tailles variées) | Dashboards BO et hubs (Settings, Reports index) : hiérarchiser par la taille du bloc, pas seulement l'ordre. Compatible `KpiTile`/`Card` existants. |
| **Dark mode comme standard soigné** (pas une inversion cheap) | Déjà l'ADN du POS (luxe-dark). Le trend confirme : surfaces étagées (`--surface-0..4`), pas de noir pur, contrastes vérifiés — continuer, ne pas dégrader. |
| **Micro-interactions fonctionnelles** (feedback d'état, pas de la déco) | Confirmation de paiement (broadcast `payment_complete` 8 s), bump KDS, save réussi en BO. Durées/easing via `motion.css` + `prefers-reduced-motion`. |
| **Variable fonts / hiérarchie typographique forte** | La hiérarchie BO ivoire se joue en poids/taille plutôt qu'en couleur. Rester dans l'échelle `typography.css` ; si un axe variable est ajouté un jour, c'est une décision cascade-tokens (escalate). |
| **États vides expressifs** | `EmptyState` avec action partout — un écran vide doit dire quoi faire ensuite. |

## ⚖️ À doser

| Trend | Verdict Breakery |
|-------|-----------------|
| **Liquid glass / glassmorphism** (translucidité, profondeur, reflets) | Autorisé uniquement en surfaces d'overlay (modal backdrop, sheet) côté POS/Customer Display, et subtil. Jamais sur du texte dense, jamais en BO ivoire (illisible sur crème), jamais sur KDS. |
| **Profondeur / élévation** | Utiliser `elevation.css` existant ; l'ombre code la hiérarchie (overlay > carte > fond), pas l'ambiance. |
| **Role-based / adaptive UI** (l'UI s'adapte au rôle) | Déjà présent sous forme de gates de permissions (sidebar, routes). Aller plus loin (réordonner l'UI par usage) = complexité de test ; seulement sur demande explicite. |
| **Imagerie produit généreuse** | Oui sur Tablet self-service et Customer Display ; non sur POS caissier (la vitesse prime sur la photo). |

## ❌ Gadgets à éviter ici

| Trend | Pourquoi non |
|-------|-------------|
| **AI-chat plaqué dans le produit** (« ask your dashboard ») | Hors scope ERP interne ; le personnel veut des chiffres fiables, pas une conversation. |
| **3D / spatial / parallax** | Coût perf sur tablettes modestes, zéro valeur pour encaisser ou lire un report. |
| **Scroll-telling / animations d'entrée séquencées** | Outil marketing, pas outil métier. Un report doit être lisible instantanément. |
| **Néo-brutalisme / maximalisme typographique** | Contredit l'identité luxe-dark/ivoire éditoriale de la marque. |
| **Carrousels autoplay** | Sur Customer Display pendant l'encaissement = anxiogène ; ailleurs = contenu caché. |

## Rappels POS/KDS issus des pratiques métier (2026)

- Vitesse et exactitude d'abord : catégories claires, modifiers en prompts forcés, la commande route vers la bonne station — le design sert la réduction d'erreurs.
- KDS : tickets organisés par station/priorité, bump/recall/hold à un tap, gros contrastes — la couleur est un code d'attente, pas un habillage.
- Écrans tactiles en environnement cuisine/comptoir : cibles larges, états pressed nets, tolérance aux doigts humides — jamais de gestes précis exigés.

## Sources (2026-07-06)

- [Enterprise UI Design in 2026 — hashbyt](https://hashbyt.com/blog/enterprise-ui-design)
- [Dashboard Design Trends 2026 — Fuselab](https://fuselabcreative.com/top-dashboard-design-trends-2025/)
- [Enterprise UX Trends 2026 — AufaitUX](https://www.aufaitux.com/blog/enterprise-ux-design-trends/)
- [15 UI/UX Design Trends 2026 — sanjaydey.com](https://www.sanjaydey.com/ui-ux-design-trends-2026/)
- [Restaurant POS features 2026 — Quantic](https://getquantic.com/restaurant-pos-system-features/)
- [Kitchen Display Systems 2026 — Sonary](https://sonary.com/pos/kitchen-display-systems/)
