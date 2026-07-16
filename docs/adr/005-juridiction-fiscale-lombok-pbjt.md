# ADR-005 — Correction de juridiction fiscale : Lombok (NTB), taxe F&B municipale

> **Date** : 2026-07-16
> **Statut** : ✅ Accepted
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Supersedes** : ADR-003 (statut PKP / PB1)
> **Contexte** : l'ADR-003 localisait The Breakery à Bali et rattachait la taxe
>   de sortie à la « Perda Provinsi Bali / PEMDA ». La boulangerie est en réalité
>   à **Lombok** (province Nusa Tenggara Barat). Vérification faite du cadre légal.

## 1. Ce qui NE change PAS (repris tel quel de l'ADR-003)

- **The Breakery est NON-PKP.** Sortie taxée à **10 %**, pas de PPN 11 % en sortie.
- Le **PPN 11 % des fournisseurs PKP n'est pas récupérable** → capitalisé dans le
  coût d'acquisition (WAC). Compte `1151 VAT Input` inactif, non droppé.
- **Pas d'e-Faktur, pas d'e-Bupot, pas d'export DJP** (features centrales DJP N/A).
- Seuil PKP **national** inchangé : révision seulement si CA > **4,8 Mds IDR/an**.
- Formule de sortie inchangée : `taxe_due = taxe_output` (pas de soustraction d'input).

## 2. Ce qui est CORRIGÉ

1. **Localisation** : The Breakery est à **Lombok, province Nusa Tenggara Barat (NTB)**
   — pas à Bali.
2. **Nature et autorité de la taxe de sortie** : la taxe F&B de 10 % relève de la
   **PBJT Makanan dan Minuman** (UU HKPD nº 1/2022, PP 35/2023), qui a remplacé
   l'ancienne « PB1 / pajak restoran ». C'est une taxe de niveau **kabupaten/kota
   (municipal)**, perçue par le **Badan Pendapatan Daerah (Bapenda)** de la commune,
   et **non** par la province ni par une « Perda Provinsi Bali ».
3. **Commune de rattachement** *(complété par Mamat le 2026-07-16)* : **Kuta,
   Kabupaten Lombok Tengah**. Autorité de perception : **Bapenda Lombok Tengah**.
   Taux appliqué : **10 %**. Aucune référence de Perda spécifique n'est retenue
   dans cet ADR (pas de numéro/année cité) ; si une Perda Lombok Tengah venant
   modifier le taux ou introduire un seuil d'omzet est identifiée un jour, elle
   déclenchera la clause de révision (§4).

## 3. Impact code

- **Aucun renommage imposé.** Le label « PB1 » reste employé dans le code
  (`PB1ManagementPage`, comptes, rapport mensuel) comme désignation usuelle de la
  taxe F&B locale ; il n'y a pas d'obligation de le renommer en « PBJT ». Si un
  renommage cosmétique est souhaité un jour, il fera l'objet d'une tâche dédiée.
- Le **rapport mensuel** reste dû, mais à la commune (Bapenda du kabupaten/kota de
  Lombok), pas à un « PEMDA Bali ».

## 4. Révision

À ré-évaluer si : franchissement du seuil PKP (CA > 4,8 Mds IDR/an), ou changement
de commune d'exploitation modifiant le taux / seuil de la Perda applicable.
