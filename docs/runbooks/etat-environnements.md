# État des environnements et reprise factuelle

Relevé initial du 8 octobre 2026 (UTC+8), validé par Mamat.
Le [complément du lot 1](#complément-du-8-octobre-2026--lot-1-de-préparation-production)
est validé par Mamat le 9 octobre 2026 ; les sections hors complément conservent
les limites du relevé initial et ne sont pas réécrites en état actuel.
Le complément du 29 octobre décrit séparément la mise en service observée.

## Usage et sources

Ce document est le point d'entrée des observations opérationnelles. Une date
décrit un relevé, jamais la durée de validité d'un environnement. Recontrôler
la cible et l'artefact réellement chargé avant toute action qui en dépend.
Ni une mémoire, ni un numéro de version, ni un résultat CI ne prouve une
installation. Aucune autorisation opérationnelle n'est accordée par ce bilan.

Les décisions restent dans les ADR et les règles dans [AGENTS](../../AGENTS.md).
Les procédures et bilans d'import restent dans le [runbook V3](production-v3-cutover.md).
Pour reprendre un chantier, utiliser le [bilan de lot](agent-tooling.md#reprise-et-clôture-dun-lot),
Git, les PR et leurs preuves. Les plans de session restent en conversation.

| Qualification | Signification |
|---|---|
| Observé directement | Lecture effectuée à la date indiquée, sur la surface nommée |
| Rapporté par une preuve datée | Constat d'un autre relevé ; non relu sur la surface réelle |
| Configuré mais non vérifié | Déclaration ou mécanisme présent, sans preuve d'exécution |
| Inconnu | Accès ou preuve insuffisants ; ne pas compléter par déduction |

## Complément du 29 octobre 2026 — mise en service V3

Statut documentaire : contenu validé par Mamat le 29 octobre 2026.
Relevé de livraison du 29 octobre 2026, UTC+8, jusqu’à 03 h 26.
Le backend, le BO et le POS sont déployés ; la recette financière de production
et le premier shift ne sont pas encore vérifiés. Cette distinction ne vaut
ni certification générale des fonctions ni autorisation d’inventer un fond de caisse.

### Candidat et cibles observés

Le candidat Git est `b29c78ee771d857f919a390af5ae16971ef43922`.
Le BO est compilé depuis ce candidat ; les artefacts POS/Android proviennent de
`82d820c92750d060fecd01806f9caaa557dbc00d`. Les deux commits ont le même arbre
`250c8316b07c972267f54b908fda9494693b2138`.
La cible compilée et déployée est la production V3 `yjhhhmjgsmyzyymvixot`.

| Surface | Observation du 29 octobre | Limite |
|---|---|---|
| Backend | Paquet de 62 migrations appliqué atomiquement ; 15 Edge Functions livrées et relues | Aucune vente de test production |
| BO | Vercel READY, domaine https://backoffice.the-breakery.com ; connexion confirmée par Mamat | Aucun parcours financier authentifié complet |
| POS caisse | https://pos.the-breakery.com ; catalogue chargé, Mamat connecté, panier vide | Shift fermé, premier encaissement non vérifié |
| Service Windows | Tâche « Breakery V3 Production » Running sous Cashier ; santé HTTPS 200 | Redémarrage du PC non testé |
| POS1 | Navigateur appairé au terminal existant ; droits conservés ; heartbeat récent | Aucun droit ajouté |
| Imprimantes | Cinq heartbeats récents ; un envoi de ticket TEST accepté par le bridge | Sortie papier physique non observée ; tiroir non actionné |
| Écran client | État « CONNECTED TO CHECKOUT » observé après retour au POS | Parcours après paiement non testé en production |
| Samsung SM-X205 | Mise à jour conservant les données, version 1.6/code 7 ; APK relue et conforme ; écran PIN observé | Connexion authentifiée et contenu des files locales non vérifiés |
| CS30 | Appareil absent du relevé USB | Aucune mise à jour constatée dans ce lot |

À 03 h 25 UTC+8, commandes, paiements, remboursements et journaux sont à zéro.
Les paiements hors ligne restent désactivés. Les stocks initiaux restent à zéro
et la configuration autorise le stock global négatif ; cela ne prouve aucun inventaire physique.

### Installation caisse et empreintes

La release caisse est `C:/BreakeryV3/releases/b29c78ee-20261029`.
Le compte existant Cashier a reçu uniquement lecture/exécution et traversée du
dossier `C:/BreakeryV3/security/production-b29c78ee`, après accord explicite.
La tâche démarre à l’ouverture de session Cashier, avec reprise sur échec.
Apache conserve l’origine LAN et relaie le bridge sur 3001 ; Olsera est conservé.
Ces réglages ne prouvent pas une reprise après reboot.

| Artefact | SHA-256 relevé |
|---|---|
| Paquet SQL production, 687 808 octets | `c0f79a452a4ae0372079c819f93e848df0dc41c3b1c4bd3f09b25360b74e541e` |
| Entrée BO `index-CJy2xbpy.js` | `a9fd8eeeeb7679b83a18376a7f97e4cc5e9b44448e083d4137f159d3b55f3551` |
| Entrée POS servie `index-B6QcfkWC.js` | `d0bd05fbf0cce1e8c5beb5d0ee1b51a603e59550ea619953ea261c8fd733c2bb` |
| APK Samsung installée | `1ea52dc8849510643cf308745d4fd9a9fa10fb0bce021f804f1161bc6d19c6ed` |

Publication BO : [workflow réussi](https://github.com/guichduh33-arch/The_Breakery_ERP/actions/runs/40739207119),
déploiement `dpl_HitfVyNBWA8LEvmznsbW6Nawf8Bi`.
La CI du candidat rapporte 1 366 tests POS, 1 934 BO et un BO ignoré ;
la preuve pgTAP porte sur 298 fichiers avec deux assertions ignorées.
Ces résultats concernent le candidat, pas le diff local de reprise historique.

### Sauvegarde, reprise historique et réserves

La sauvegarde physique Supabase disponible est datée du 29 octobre à 00 h 04 UTC+8.
Mamat a explicitement accepté la réserve : aucun nouvel export natif complet ni
restauration fraîche n’est prouvé avant cette livraison. Un complément logique
chiffré a été conservé ; ce fichier partiel ne remplace pas un dump restaurable
complet. La sauvegarde quotidienne autonome n’est pas activée.

La décision d’importer les ventes historiques d’octobre remplace l’ancienne
consigne de conserver zéro vente. Au présent relevé, les imports réels et le
socle local d’import historique ne sont pas installés en production. Les produits
et recettes sont conservés ; aucune purge n’est effectuée.

Restent non vérifiés : ouverture du premier shift avec fond réel, premier
encaissement, sortie papier sur place, connexion Samsung authentifiée,
mise à jour CS30, reprise après reboot et sauvegarde quotidienne autonome.

### Preuves privées de ce relevé

Les justificatifs sont hors Git, sous le profil utilisateur, dans
`.codex/visualizations/2026/10/17/01a14a32-8220-7fd2-bd43-ffcff5d86720/` :
`production-cutover-backend-20261029.json`, `production-bo-verification-20261029.json`,
`production-edge-source-readback-20261029.json`,
`samsung-production-installed-observed-20261029.json` et les captures
`production-pos-live-paired-20261029.png`, `production-pos-print-test-20261029.png`,
`production-windows-service-observed-20261029.png`.
Le JSON backend relu après correction porte l’empreinte
`38c80a8b7df199386e36ddcf897c5abcadaf84d56f3ee1f2404fb7b4ea70322a`.
Il conserve l’ancien blocage Windows et les observations qui le lèvent.
Ces preuves privées ne sont pas transportées par un clone ; aucun secret, code
d’activation ou jeu de données client n’est ajouté à ce bilan.

## Complément du 8 octobre 2026 — lot 1 de préparation production

Statut documentaire : validé par Mamat le 9 octobre 2026.
Le lot termine un inventaire en lecture seule, pas une recette de production.
Les inconnues ci-dessous restent des conditions de départ non satisfaites.
Aucun démarrage applicatif, reboot, déploiement, installation sur appareil,
restauration ou essai créant une vente ou un paiement n'a été effectué.

### Sauvegardes et conservation

Observé directement dans le dashboard du projet `yjhhhmjgsmyzyymvixot` :
sept sauvegardes physiques quotidiennes du 1er au 7 octobre UTC, la dernière
au 8 octobre à 00:04:42 UTC+8. Le PITR est désactivé. Le dashboard précise que
les objets Storage sont exclus ; aucune sauvegarde n'a été téléchargée.
La liste visible ne prouve ni une restauration, ni la conservation contractuelle.

La restauration métier sur cible isolée, la copie externe des objets Storage,
des secrets, des configurations boutique et des files offline restent inconnues.
Les fichiers présents sur le PC ne prouvent pas une sauvegarde indépendante.
Le responsable et l'emplacement de conservation externe ne sont pas établis.

### Installations et exécution observées

| Composant | Observation directe datée du 8 octobre | Limite |
|---|---|---|
| POS conservé sur PC | `C:/BreakeryV3/releases/1fc54978/pos` : 122 fichiers conformes au manifeste, aucun fichier supplémentaire ; cible compilée production | SHA `1fc549787c0ae1b735553282747ce458c65b2815` déclaré par le manifeste ; provenance de compilation et application chargée non certifiées |
| Bridge corrigé conservé | Release `bridge-prod-printer-presence-20261008`, empreinte du `server.cjs` relevée | SHA source et intégrité complète des dépendances inconnus ; processus non observé |
| PC `Pos`, `192.168.1.92` | À 21:35:49 UTC+8, aucun processus Node ni écoute sur 3001/3443 ; runtime Node installé 24.13.1 | Observation ponctuelle ; pas de preuve TLS servi, de service actif ou de reprise après reboot |
| Démarrage Cashier | Raccourci vers `Desktop/breakery-caisse/demarrer-caisse.cmd`, port 3001 et dossier `pos-dist` de ce répertoire | Autre bundle que la release vérifiée ; asset d'entrée production, anciens assets dev présents ; leur présence ne prouve pas leur chargement |
| Samsung SM-X205 | ADB USB : POS 1.5/code 6, mise à jour rapportée 00:45:14 ; APK exact lu et ciblant production | Aucun processus POS détecté ; WebView/cache chargé et SHA source inconnus |
| CS30 Android 11 | ADB USB : POS 1.5/code 6, mise à jour rapportée 00:50:40 ; même APK que la Samsung | Aucun processus POS détecté ; WebView/cache chargé et SHA source inconnus |
| KDS et écran client | Aucune identité de bundle chargé établie sur les surfaces accessibles | Recette physique et versions chargées inconnues |

SHA-256 commun aux deux APK installés :
`e0814960e7d0ad856231aa3001671793c7b49738a358f11c3db73b81c73f6ca0`.
Les copies privées sont conservées sous `.release-manifests/android-delivery-20260930/`,
dans `installed-samsung-observed-20261008.apk` et `installed-cs30-observed-20261008.apk`.
Elles diffèrent des APK historiques du 30 septembre ; aucun SHA source ne leur
est attribué par déduction. L'ADB local a été démarré pour la lecture USB.

Certificat public sur disque pour `pos.the-breakery.com` : expiration le
29 décembre 2026 à 10:48:45 UTC+8. La tâche `Breakery V3 TLS Renewal` rapporte
un résultat 0 le 8 octobre à 03:08:46, selon l'horloge du PC distant.
Cela ne certifie ni le certificat servi, ni le prochain renouvellement.

### Écarts cloud et limites de livraison

Relecture directe à 21:38:33 UTC+8 sur production : `business_config` ne contient
aucune ligne, commandes et paiements sont à zéro. Les réglages métier ne sont
donc pas réputés initialisés ; l'ancien constat de paiements offline désactivés
ne vaut pas preuve d'une configuration métier effective.
L'inventaire des Edge Functions expose sept fonctions actives, dont le heartbeat,
mais pas `process-payment`, `refund-order`, `void-order` ou `cancel-unpaid-order`.

Rapporté par la conversation du 8 octobre : comparaison de 380 signatures SQL
applicatives sur dev, production et répétition, avec égalité des corps après
normalisation des seuls retours à la ligne. Ce résultat ne certifie pas les
données, les Edge Functions ou un parcours métier. Les sorties intégrales de
cette comparaison ne sont pas disponibles dans le justificatif local de reprise.
Le BO relevé sur `23fbbf0903c3ec136f0e63d9e6d3f6521c567c08` et le candidat Git
`17b2ea37112b277bcb69f521efff9e76dd27aaa8` restent des identités distinctes.
La preuve pgTAP du candidat n'est pas établie par ce lot ; aucune suite cloud
n'a été déclenchée pour compléter ce contrôle.

### Références de preuve et clôture

Les observations boutique, ADB et dashboard sont transcrites dans le justificatif
privé `.release-manifests/production-candidate-20261005/lot1-backups-installation-observed-20261008.json`.
La relecture cloud finale est conservée dans `lot1-production-final-observed-20261008.json`
du même dossier. Leurs empreintes sont restituées dans le bilan conversationnel.
Ces fichiers ignorés ne sont ni une sauvegarde DB, ni un export des captures,
ni un contenu transporté par un clone propre. Les observations brutes de l'UI
et de l'ADB restent dans la conversation ; les secrets et données clients ne
sont pas recopiés dans ce document.

L'inventaire est terminé avec réserves explicites. Les corrections de configuration,
le déploiement des fonctions manquantes et la répétition physique restent des
travaux ultérieurs exigeant leur propre périmètre et autorisation.
Les contrôles locaux du 8 octobre ont réussi : liens relatifs, miroirs agents,
garde des références documentaires interdites et `git diff --check`.
La garde signale une baseline préexistante trop permissive dans `kiosk-issue-jwt`,
laissée hors périmètre. Aucun test applicatif, pgTAP ou E2E n'a été exécuté.
La conservation du complément sur `docs/production-lot1-observations` est validée,
sans PR ni push ; la validation documentaire reste distincte d'une permission de bascule.

## Développement et livraison POS

Observé directement le 8 octobre 2026 : la
[PR #560](https://github.com/guichduh33-arch/The_Breakery_ERP/pull/560) est fusionnée
dans `ade24e2294ce0c6a742088ff72a7066b0aa2415c`, le 8 octobre à 02:58:57 UTC+8.
Le contrôle CI principal et la gouvernance de ce commit sont réussis dans le
[run 37670993875](https://github.com/guichduh33-arch/The_Breakery_ERP/actions/runs/37670993875).
Le contrôle Supabase Preview est ignoré ; ce n'est pas une preuve SQL.

Le relevé physique antérieur décrit les optimisations du panier et des
variantes, le préchargement des options tablette, le routage cuisine et la
présence des imprimantes. La fusion prouve la livraison Git du lot, pas son
installation intégrale sur les terminaux. Les mesures p95 PC/Android, les prix
avec client, les réponses promotionnelles désordonnées, la reconnexion et
l'écran client après paiement ne sont pas certifiés par ce relevé.

## Back-office et Vercel

| Observation | Date | Qualification et preuve | Limite |
|---|---|---|---|
| BO production sur le SHA `23fbbf0903c3ec136f0e63d9e6d3f6521c567c08` | 8 octobre 2026 | Observé directement : API Vercel, déploiement `dpl_6Vd7MVZYV8fo7DVR3eiKN6DcHMRE`, état READY, cible production | État Vercel ; bundle dans un navigateur et connexion non relus |
| Alias `backoffice.the-breakery.com` associé à ce déploiement | 8 octobre 2026 | Observé directement : API des alias du déploiement | Ni test HTTP ni parcours métier |
| Publication manuelle réussie sur ce SHA | 8 octobre 2026 | Observé directement : [run 37391497089](https://github.com/guichduh33-arch/The_Breakery_ERP/actions/runs/37391497089) | Résultat d'une publication datée, pas des changements ultérieurs |
| Tentative production du SHA de fusion #560 | 8 octobre 2026 | Observé directement : API Vercel, `dpl_4w5SWTLm5sDaEK25892dJM9Edwos`, état CANCELED | Fusion Git distincte d'une publication BO |

L'API projet a retourné `live: false` et une dernière tentative annulée.
Ces champs ne suffisent pas à conclure que le BO est indisponible : le
déploiement READY et ses alias ont été inspectés séparément. L'état réellement
servi au navigateur reste inconnu dans ce relevé.

## Supabase et données

| Cible | Référence | Dernière preuve disponible | Qualification et limite |
|---|---|---|---|
| V3 dev | `ikcyvlovptebroadgtvd` | Bilans et CI ; migration de garde rapportée le 5 octobre dans le [guide de coupure](pos-internet-outage.md#livraison-vérifiée-le-2026-10-05) | Rapporté ; schéma et fonctions actuels non relus |
| V3 répétition | `getctmbpjnrrjzncaqze` | Relevé de préparation du 29 septembre 2026 | Rapporté ; disponibilité, état actuel et conservation à décider |
| V3 production | `yjhhhmjgsmyzyymvixot` | [Imports et coûts des 6 et 7 octobre](production-v3-cutover.md) | Rapporté ; aucune certification actuelle de l'ensemble du schéma, des droits ou des données |
| Ancienne V2 | `abjabuniwkqpfsenxljp` | Identité historique | Ne reçoit pas la lignée V3 ; usage actuel inconnu |

Le MCP Supabase sous le préfixe imposé par AGENTS n'était pas exposé pendant
ce relevé. Aucune requête DB ni inspection de fonctions live n'a été effectuée.
Les identités ne prouvent pas la cible d'une application chargée.

Les imports rapportés ne constituent pas une ouverture réelle : les stocks
physiques et soldes restent à intégrer selon le bilan V3. Les coûts exclus
ou absents ne sont pas réputés validés. La restauration complète n'est pas
prouvée par ces imports ou par leurs essais sous rollback.

## Boutique, terminaux et matériel

Les observations suivantes sont rapportées par la note de reprise V3 et les
preuves locales datées. Aucun appareil boutique n'a été relu pendant ce relevé.

| Composant | Cible / identité | Date et version rapportées | Résultat rapporté | Limite |
|---|---|---|---|---|
| PC caisse / POS1 | PC `POS`, LAN `192.168.1.92`, V3 production | 7–8 octobre : PC servant POS et bridge | Appairage et présence observés ; Mesh utilisé comme télécommande | SHA/empreinte du POS réellement chargé inconnus ici ; reboot non éprouvé |
| Print bridge | V3 production ; `C:/BreakeryV3/releases/bridge-prod-printer-presence-20261008` | 8 octobre | Release corrigée démarrée ; premier paquet incomplet remplacé après remise temporaire de l'ancienne release | SHA et empreinte du bridge non établis ; service permanent non certifié |
| Galaxy Tab A8 SM-X205 | Tablette serveur, V3 production rapportée | 30 septembre : 1.4 / code 5 ; 7–8 octobre : 1.5 rapportée | Installation conservant les données ; ajout Fresh Juice / Orange observé dans le relevé récent | Empreinte de l'APK actuellement installée inconnue ; version seule insuffisante |
| CS30 Android 11 | Tablette serveur, V3 production rapportée | 30 septembre : 1.5 / code 6 ; 7–8 octobre : 1.5 rapportée | Installation ADB et activité observées ; pas une caisse | Bundle actuellement chargé non relu |
| KDS et écran client | Service local prévu par ADR-033 | Versions installées inconnues | Parcours locaux décrits dans le code et les bilans | Aucune recette actuelle complète |
| Imprimantes | Caisse `.8`, cuisine `.13`, waiter `.14`, display `.15`, barista `.32` sur `192.168.1.*:9100` | 7–8 octobre | Sondes TCP sans octet d'impression et enrichissement du registre rapportés | Aucune imprimante coupée ; aucune impression physique dans ce lot |
| EF heartbeat | `lan-heartbeat-batch`, V3 production | 8 octobre | Déploiement et présence BO rapportés | Version/corps/configuration live non relus |

La version Android ne désigne pas un bundle unique : le relevé du 30 septembre
distingue deux APK 1.4 de contenu différent. Le candidat des bundles Android
à cette date était `1fc549787c0ae1b735553282747ce458c65b2815` ; cela n'attribue
pas ce SHA aux applications modifiées ensuite.

Le relevé récent rapporte les deux tablettes devenues `stale` après arrêt de
leurs heartbeats, ainsi que les paiements hors ligne désactivés dans le BO.
Recontrôler ces états avant toute action. Aucun paiement n'a été créé pendant
les essais récents rapportés. Ces essais n'autorisent pas une vente future.

## Certificats, démarrage et retour arrière

Rapporté au 30 septembre : certificat public pour `pos.the-breakery.com`,
tâche de renouvellement testée et sonde HTTPS/WSS à `:3443` ; accès protégé
refusé sans identité appareil. Le certificat et les secrets sont hors Git.
Le serveur lit les fichiers TLS au démarrage ; rechargement, ACL et démarrage
permanent LocalService n'étaient pas acquis dans ce relevé. Leur état actuel
est inconnu. Apache et l'ancien service caisse étaient préservés.

La signature Android était identique pour les remplacements rapportés du
30 septembre, sans désinstallation. Le contenu des files offline n'était pas
inspecté ; la conservation des données ne certifie pas leur rejeu.

Observé directement le 8 octobre sur les artefacts locaux : les SHA-256 des
APK concordent avec `tablet-proof.json` et `cs30-proof.json` du dossier Android :

- APK tablette 1.4 : `105b885af39ea1e6faf67f53544ec628beb17a0b4d557e772c2d654da6eca58f`.
- APK V3 1.5 : `5e99d90dd6d045ab417f8176ab05431ae14add8b75b824e63e8c1ba2e71935d8`.
- Certificat public rapporté par ces preuves : `100d48b8b0070544183a6437fe4139f1bc54ebd8d82318af5e226833b26c1477`.

Ces empreintes identifient les fichiers locaux, pas les APK actuellement
chargées sur les appareils. Les preuves JSON rapportent la vérification des
versions après installation au 30 septembre ; aucun appareil n'est relu ici.

La remise temporaire de l'ancien bridge le 8 octobre prouve uniquement ce
geste rapporté. Aucun rollback général ni restauration DB complète n'est
certifié. Utiliser les limites du [retour arrière V3](production-v3-cutover.md#arrêt-et-retour-arrière)
avant de promettre une réversibilité.

## Conservation des preuves et transfert

| Preuve privée ou locale | Date | Emplacement déclaré | Empreinte / disponibilité |
|---|---|---|---|
| Imports catalogue, recettes et coûts | 6–7 octobre | `.release-manifests/production-candidate-20261005/` ; noms détaillés dans le bilan V3 | Non versionnés ; empreintes non relevées ici |
| APK et empreintes Android | 30 septembre, fichiers relus le 8 octobre | `.release-manifests/android-delivery-20260930/` | Non versionnés ; empreintes locales ci-dessus, appareil actuel non relu |
| Préparation, schéma et répétition | 29 septembre–5 octobre | `.release-manifests/v3-bootstrap/` et preuves locales mentionnées dans la note | Non certifiés comme dossier complet transférable |
| Note source de reprise | Jusqu'au 8 octobre | Ancien chemin `.release-manifests/v3-bootstrap/memoire-mise-en-production.md` ; historique Git | Observations transférées ; retrait validé par Mamat le 8 octobre |

Un clone transporte les documents commités, pas les justificatifs privés,
APK, accès, certificats ou chats locaux. La date, la référence et l'empreinte
d'un justificatif doivent accompagner son transfert privé autorisé ; aucun
secret ou jeu de données client ne doit être ajouté au bilan Git.

Mamat a validé le transfert et le retrait de la note source le 8 octobre 2026.
Les observations utiles sont reprises ici ; les préparations renvoient aux
procédures existantes. Les autorisations rapportées et anciennes premières
actions ne sont pas des permissions nouvelles. L'historique reste dans Git ;
ne pas y puiser une consigne plus ancienne contre les sources actuelles.
