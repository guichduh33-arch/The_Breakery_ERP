# ADR-026 — Le dashboard B2B : les agrégats quittent le client

> **Date** : 2026-08-13
> **Statut** : ✅ Accepted (2026-08-13 — validé avec le lancement du lot 5)
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Supersedes** : — (ne modifie aucun ADR)
> **Complète** : ADR-024 (liste de stock) et ADR-025 (liste des commandes) — le même
> principe, appliqué à la troisième surface qui comptait côté client.
>
> **Convention** : aucune version d'objet DB (`_vN`) dans cet ADR — on cite la
> **famille**. La version vivante se vérifie dans `supabase/migrations/` et au
> call-site.

## Contexte

Le dashboard B2B (`/backoffice/b2b`) répond à « où en est mon canal wholesale » :
clients actifs, revenu mensuel et sa variation, encours impayé, commandes en
cours, aging. Un relevé du 2026-08-13 (audit des pages B2B) a établi comment ces
chiffres sont fabriqués aujourd'hui :

- **Les comptes purs sont sains** : total et en-cours de commandes sont des
  `count` serveur (`head: true`), rien ne voyage.
- **Tout le reste est agrégé côté client** : le hook lit `view_b2b_invoices`
  **en entier, sans pagination**, puis calcule en mémoire le revenu mensuel, sa
  variation, le top clients et les clients actifs. L'encours et l'aging lisent
  `view_ar_aging` en entier.

C'est la classe de défaut nommée par l'ADR-024 : un agrégat calculé sur les
lignes chargées est un échantillon présenté comme un total. Aujourd'hui le
volume B2B d'une boulangerie rend l'échantillon complet ; le jour où la vue
dépasse ce qu'une lecture ramène (limite PostgREST, pagination future), les
chiffres du dashboard deviendraient silencieusement faux — le pire mode de
défaillance pour un écran de pilotage. La dérogation « jeu borné compté en
mémoire » (ADR-025, §3, cas de la liste clients) ne protège pas ce dashboard :
`view_b2b_invoices` grandit avec CHAQUE commande, ce n'est pas un référentiel
borné.

## 1. Décisions

### Décision 1 — Une famille de compteurs serveur sert les agrégats du dashboard B2B

Une famille de lecture dédiée (`get_b2b_dashboard_counters`) sert, pour le
dashboard : clients actifs, revenu du mois et du mois précédent (la variation se
dérive), encours impayé total, top clients (bornés et triés serveur), et les
comptes déjà servis aujourd'hui (total, en cours) qui peuvent y être fondus.
L'aging reste servi par `view_ar_aging` (agrégat déjà côté serveur, une ligne
par client et par tranche).

**Pourquoi.** Même principe que l'ADR-024 décision 1 et l'ADR-025 décision 1 :
l'agrégat se calcule là où vivent toutes les lignes. La fonction porte la même
exigence de permission que les lectures qu'elle remplace (`b2b.read`), avec la
paire REVOKE (PUBLIC + anon) et le GRANT explicite `authenticated` de rigueur.

### Décision 2 — Le fuseau des « mois » est le fuseau métier de la base

Le revenu « mensuel » se découpe sur les bornes de mois du fuseau métier
(paramètre de session PostgreSQL, ADR-019), pas sur celles du navigateur. Le
calcul client actuel découpait les mois dans le fuseau du poste — un poste mal
réglé aurait produit un « mois » différent pour le même canal.

### Décision 3 — La parité est tenue par un test exécuté

Un test pgTAP vérifie, sur jeu semé : la parité de chaque agrégat avec le calcul
naïf en SQL sur les mêmes lignes ; le cas fenêtre vide (des zéros VRAIS, pas des
NULL) ; et le refus au rôle sans `b2b.read` (garde négative, ADR-021 déc. 6).

## 2. Conséquences

1. **Une fonction nouvelle, aucune modifiée.** Migration à numérotation
   monotone, types régénérés (`types.generated.ts`).
2. **Le hook du dashboard remplace le rollup non paginé** par l'appel à la
   famille de compteurs. Le front garde sa règle d'affichage ADR-025 : tirets
   pendant le chargement et sur échec, jamais des zéros fabriqués.
3. **Aucune reprise de données, aucune table touchée.**

## 3. Ce que cet ADR ne tranche pas

- **La page Payments.** Ses tuiles lisent le même hook ; elles héritent de la
  bascule sans décision propre. Ses listes Received/Outstanding restent des
  lectures de lignes, hors du principe.
- **Un éventuel filtre de période sur le dashboard.** La fonction naît sur les
  fenêtres fixes actuelles (mois courant / mois précédent / tout) ; un contrôle
  de période serait une évolution de la fonction qui ne rouvre pas cet ADR.
- **La liste des commandes B2B.** Elle charge un jeu aujourd'hui borné et filtre
  en mémoire — le cas que l'ADR-025 laisse explicitement hors du principe. Si
  elle devient paginée, le principe s'applique sans nouvel ADR.

## 4. Révision

Les décisions 1 à 3 ne se rouvrent que par un nouvel ADR. Ajouter un agrégat à
la famille de compteurs n'en demande pas, tant que les décisions 1 et 3 tiennent.
