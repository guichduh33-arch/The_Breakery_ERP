# Audit waiter → caisse → cloud → back-office — 19 septembre 2026

Rapport factuel et suivi durable des corrections. Documentation et publication
autorisées par Mamat après présentation des résultats. Les intentions métier et
les ADR ne sont pas modifiés. Ce rapport complète le
[relevé du 22 août](2026-08-22-audit-pos-waiter.md), dont les constats restent datés.

## Périmètre et verdict

Tests de commandes et paiement sur Supabase V3 développement
`ikcyvlovptebroadgtvd`, pas sur V2 production. Tab A8 Android 14 réelle,
caisse Windows `192.168.1.92`, KDS ouvert sur cette caisse, back-office déployé.
La session matérielle était celle de Mamat ; les droits waiter/CASHIER/ADMIN
ont été éprouvés séparément par pgTAP avec rôle authenticated et rollback.

Le parcours connecté est démontré. Le routage hors ligne corrigé dans l'APK
1.2 est démontré, ainsi que le rejeu unique en base. La validation globale
reste ouverte : double affichage KDS après rejeu, présentation BO avant paiement
incohérente et restauration de session sans cloud bloquée.

## Preuves

| Scénario | Résultat observé |
|---|---|
| Envoi Tab A8 avec réponse HTTP volontairement perdue, puis rechargement et nouvelle tentative | Même clé, même UUID, une seule commande en base |
| Reprise caisse puis ajout depuis la tablette | Deux Americano Hot, actualisation automatique de Rp35 000 à Rp70 000 |
| Cuisine puis paiement Cash simulé sur V3 | Deux lignes Ready ; un paiement Rp70 000 ; accusé imprimante affiché, papier non observé |
| Détail BO payé | Deux lignes, base hors PB1 Rp63 600, PB1 incluse Rp6 400, total Rp70 000 et paiement identique |
| Coupure HTTP Supabase sur la tablette, hub disponible | Plan conservé ; avec 1.2, L-3 visible au KDS Barista avant retour cloud et zéro commande correspondante en base pendant la coupure |
| Retour cloud | Une commande T119092026009, une ligne Rp35 000, historique tablette et détail BO accessibles |
| KDS après retour cloud | L-3 et T1-009 affichés simultanément : échec de réconciliation visuelle |
| Veille courte et réveil par ADB | Connexion ONLINE et historique conservés ; veille prolongée non démontrée |
| Rechargement pendant la coupure | Restauration de session bloquée ; reprise après retour cloud |

Identifiants des preuves conservées dans la base de développement :

- T119092026004 : `ecc101f4-8515-4aaa-962e-bf262111a66c`, T-01,
  payée Rp70 000, note `TEST INTEGRAL 20260919-2020 - DO NOT PREPARE`.
- T119092026005 : `75c83f2b-e477-448e-809a-4bd7fd22e8c8`, T-02,
  test avant correction du routage, Ready et pending_payment.
- T119092026009 : `c83f9d59-4ce0-4987-a505-d0879937d762`, T-03,
  ticket local L-3, clé `508872cb-f194-4bea-aa0a-b227d9ec5925`,
  note `TEST OFFLINE FIX 20260919-2100 - DO NOT PREPARE`, pending_payment.

Les commandes matérielles n'ont pas été supprimées ; les scénarios pgTAP ont
été annulés par rollback. La coupure était simulée dans le WebView, pas une
panne physique du Wi-Fi, du routeur ou de l'ensemble du magasin.

## Corrections livrées

- Conservation de la tentative d'envoi et de sa clé après rechargement ;
  une tentative cloud incertaine ne devient pas un second ticket LAN.
- Propagation des échecs de stockage durable et distinction entre sauvegarde
  locale et publication au hub, sans prétendre prouver l'affichage KDS par le seul envoi.
- Restauration du plan de salle, notifications filtrées par serveur sans cache,
  actualisation des listes après rejeu et compatibilité de hauteur ancien WebView.
- Préchargement et persistance du routage cuisine, variantes comprises : le
  premier test hors ligne envoyait une liste de stations vide ; la 1.2 envoie barista.
- Caisse mise à jour : son ancien bundle appelait des RPC absentes de V3.
  Sauvegarde locale conservée ; index remplacé après copie des assets et contrôle
  des empreintes. Bridge et données navigateur préservés.
- Raccourci Windows corrigé après autorisation explicite : lanceur local
  `C:\Users\Cashier\Desktop\breakery-caisse\demarrer-caisse.cmd` à l'ouverture
  de session Cashier. Aucun redémarrage Windows n'a encore démontré ce démarrage.

Le lanceur et le bundle résident sur la caisse. Le poste de développement a
servi au transfert et aux tests ; son arrêt n'a pas été testé pendant un service.

## Corrections restantes à reprendre

Ces entrées constituent la mémoire de suivi du chantier ; elles restent ouvertes
jusqu'à obtention des preuves ci-dessous. Elles ne prescrivent pas une nouvelle
architecture ni une modification des règles métier.

| Référence | Priorité et constat | Critère de clôture |
|---|---|---|
| WAITER-01 | Haute : ticket local et cloud doublés au KDS après rejeu | Une seule carte par commande après retour cloud, reconnexion et rattrapage du hub ; états de préparation conservés ; aucune comparaison approximative par table, produit ou note |
| WAITER-02 | Haute : détail BO non encaissé à total/taxe zéro et serveur non affiché malgré une ligne Rp35 000 et waiter_id renseigné | Présentation cohérente avant et après reprise/paiement ; distinction explicite entre montant provisoire et montant encaissé ; tests BO complets si code BO modifié |
| WAITER-03 | À arbitrer : démarrage/rechargement sans cloud bloque sur auth-get-session | Définir et valider une restauration hors ligne respectant droits, expiration et révocation ; aucun contournement du contrôle d'accès |
| WAITER-04 | Validation matérielle incomplète | Installer 1.2 sur CS30 puis tester avec rôle serveur ; veille prolongée, perte réelle du hub, écran cuisine distinct et redémarrage autonome Windows |
| WAITER-05 | Diagnostic : imprimante Waiter 192.168.1.32 non joignable | Identifier l'équipement et vérifier connexion puis impression physique ; les autres imprimantes répondaient en TCP, ce qui ne prouve pas le papier |

Points de reprise dans le code :

- WAITER-01 : `apps/pos/src/features/kds/KdsBoard.tsx` fusionne les lignes locales
  et cloud ; `apps/pos/src/features/kds/kdsOfflineStore.ts` conserve les lignes
  locales ; `apps/pos/src/features/lan/offlineReplay.ts` ne transmet pas leur
  correspondance avec l'UUID cloud après le rejeu tablette.
- WAITER-02 : comparer le détail BO aux lignes de commande, à waiter_id et aux
  agrégats avant encaissement ; le détail payé du premier scénario était correct.
- WAITER-03 : `apps/pos/src/App.tsx` bloque le routeur en erreur de restauration ;
  `apps/pos/src/stores/authStore.ts` exige le service de session au démarrage.

## Livraison et validation technique

Branche `fix/waiter-apk-end-to-end`, correction 1.2 au commit `12da34f4`,
[PR 529](https://github.com/guichduh33-arch/The_Breakery_ERP/pull/529).
APK 1.2, versionCode 3, applicationId `com.thebreakery.pos`, installée sur Tab A8
avec réglages et identité conservés. CS30 Android 11 / Chromium 94 : 1.1 installée,
écran de connexion observé ; 1.2 non installée au dernier relevé USB.

Fichier local livré : `outputs/waiter-1.2/The-Breakery-Waiter-1.2.apk`.
Ce répertoire de sortie n'est pas versionné ; une nouvelle machine doit
refabriquer l'APK selon le [runbook](../runbooks/tablet-capacitor-build.md).

- SHA-256 APK : `efe9c48d4989b398bcc7db291e029587875225c8b36524dfa6476bba42e36e35`.
- SHA-256 certificat : `100d48b8b0070544183a6437fe4139f1bc54ebd8d82318af5e226833b26c1477`,
  identique à l'ancienne APK ; certificat Android Debug. Mise à jour sans désinstallation.
- Après correction : 31 tests ciblés réussis, typage, lint, dix gardes et builds
  web/Android réussis. Scénario pgTAP trois rôles : 12 assertions réussies.
- CI du commit 12da34f4 relevée le 19 septembre : gouvernance, lint/typage/tests/build,
  Playwright E2E et pgTAP réussis. Les étapes ignorées ne sont pas une validation.

Pas de migration ni de changement de protocole hub pour la correction 1.2.
La suite BO complète devra être exécutée lors de WAITER-02 si le BO est modifié.
